# Phase 4: In-Turn Task Tracking

Status: Complete
Date: 2026-05-04

Simplified Chinese version: [phase-4-in-turn-task-tracking.zh-CN.md](./phase-4-in-turn-task-tracking.zh-CN.md)

## 1. Purpose

Implement the `update_todos` tool and planning stall detection, aligned to OpenClaw's confirmed `update_plan` / planning stall architecture.

Source confirmation: `docs/research/openclaw-implementation-notes.md` Section 8 (third research pass, 2026-05-04).

## 2. Design Summary

OpenClaw's in-turn execution pattern:

```
model_response
  → if plan-only text and no tool calls: inject retry instruction
  → if tool calls: execute tools, feed results back
  → model may call update_plan at any point to track step progress
```

Peewit Phase 4 implements this with two deliverables:

1. `update_todos` tool — model-called, full-replace step tracker
2. Planning stall detection in `AgentRuntime` — detect and retry plan-only turns

## 3. Part A: `update_todos` Tool

### Interface

```typescript
// Tool name: update_todos
// Input schema:
{
  todos: Array<{
    content: string;          // step description
    status: "pending" | "in_progress" | "completed";
  }>
}
```

At most one item may be `in_progress` at a time (validated).

### Behavior

- The model calls `update_todos` at any point during a turn.
- `AgentRuntime` stores the latest todo list in the current run state.
- The tool result is `{ ok: true }` — the model continues immediately.
- CLI renders the current todo list when it changes.
- The todo list is reset at the start of each new turn.

### Package

Add `createUpdateTodosTool()` to `packages/tools/src/index.ts`. This is a regular `ExecutableTool` — no special infra support needed.

### CLI Display

After each assistant response, if `update_todos` was called, show:

```
Tasks:
  ✓ Read the README
  → Write a summary  (in progress)
  · Create a pull request
```

## 4. Part B: Planning Stall Detection

### Detection Patterns

In `AgentRuntime`, after receiving a `type: "message"` model response (no tool calls), check if the response looks like a planning-only output:

```typescript
const PLAN_PROMISE_RE = /\b(I'?ll|let me|I'm going to|I will|I plan to)\b/i;
const PLAN_HEADING_RE = /^(plan|steps|approach|here'?s what I|my plan)[:\s]/im;
const PLAN_BULLET_RE = /^(\d+\.|[-*])\s+\w/m;
```

A response is "planning-only" if it matches any of these AND contains no tool calls.

### Retry Instruction

When a planning-only response is detected, inject a system-level retry message into the context:

```
Do not restate the plan. Act now: take the first concrete tool action you can.
```

Then re-run the model with this injected message.

### Termination

After `maxPlanningStallRetries` consecutive planning-only turns (default: 2), emit `run_failed` with message:

```
Agent stopped after repeated plan-only turns without taking action.
```

### Configuration

Add `maxPlanningStallRetries?: number` to `AgentRuntimeDependencies` (default: 2).

## 5. Part A Test Requirements

- `update_todos` tool validates schema (max one `in_progress`)
- Tool call with valid list returns `{ ok: true }`
- Invalid status value is rejected with a clear error
- Empty list is accepted (resets the tracker)
- CLI renders updated todo list after model call

## 6. Part B Test Requirements

- Planning-only detection fires on promise phrases
- Planning-only detection fires on step headings
- Planning-only detection fires on bullet lists
- Detection does NOT fire when model calls at least one tool
- Retry instruction is injected on first stall
- Run terminates after `maxPlanningStallRetries` consecutive stalls
- Run does not terminate if model acts before the stall limit

## 7. Implementation Order

1. `update_todos` tool in `packages/tools/`
2. Wire `update_todos` into `AgentRuntime` and register it in CLI
3. CLI todo display
4. Stall detection in `AgentRuntime`
5. Stall detection tests in core

## 8. Non-Goals

- No infra-driven step orchestration
- No subagent spawning
- No persistent TaskFlow
- No pre-execution plan approval gate

## 9. Related Documents

- [Roadmap Phase 4](../roadmap/overview.md)
- [Agent Loop](../architecture/agent-loop.md)
- [OpenClaw Implementation Notes Section 8](../research/openclaw-implementation-notes.md)

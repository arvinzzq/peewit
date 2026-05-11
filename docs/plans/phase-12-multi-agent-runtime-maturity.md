# Phase 12: Multi-Agent Runtime Maturity

Status: Planned
Date: 2026-05-11

Simplified Chinese version: [phase-12-multi-agent-runtime-maturity.zh-CN.md](./phase-12-multi-agent-runtime-maturity.zh-CN.md)

## 1. Purpose

Phase 12 upgrades Vole's sub-agent system from "barely usable single-shot spawning" to OpenClaw-grade multi-agent execution: push-based completion, fork context mode, depth and concurrency policy, and an inspection / control surface.

Phase 10 shipped `spawn_subagent`, `spawn_subagent_async`, and `check_subagent`, but the implementation is intentionally minimal: parents must poll, depth is enforced only by omitting the spawn tool from the sub-agent's tool list, context is always `isolated`, and there is no way to cancel, time out, or steer a running sub-agent. These gaps were acknowledged in `openclaw-alignment.md` Gap 15, where `fork` mode was designed but never implemented.

This phase depends on Phase 11's lane infrastructure for concurrency control and structured session keys for parent / child tracking.

## 2. Scope

This phase includes:

- TaskFlow record gains a `pendingAnnouncementForParent` field; the runtime drains it at the start of each parent turn and injects a system message describing each completed child.
- `SubagentFactory.create(goal, options)` accepts `{ contextMode: "isolated" | "fork", parentMessages?, depth, parentSessionKey }`.
- `fork` mode copies the parent's transcript into the child session before the first turn.
- Lane-enforced concurrency: subagent lane caps global parallel children; per-parent `maxChildrenPerAgent` (default 5) caps active children for one parent.
- Depth policy: `maxSpawnDepth` (default 1, orchestrator 2, hard cap 5); the factory strips `spawn_subagent*` from the child's tool list when depth equals or exceeds the cap.
- Cancellation: `runTimeoutSeconds` parameter aborts the child run when the lane scheduler observes the deadline; `cancel(runId)` cascades to all descendants.
- Subagent management surface: new `subagents` tool family with subcommands `list`, `log`, `info`, `kill`, `steer`, `send`.
- CLI commands: `vole subagents list`, `vole subagents kill <id|all>`.

This phase does not include:

- Sub-agents in separate OS processes or worker threads (Phase 16 considers this).
- Independent agent identity per child (Phase 15).
- Channel-initiated sub-agents (Phase 15).
- Cross-machine sub-agent dispatch.

## 3. Architecture Summary

### Push-Based Completion

A completing sub-agent writes its terminal summary to the TaskFlow record and adds a structured entry to `pendingAnnouncementForParent` on the parent record. On the parent's next `runTurn`, the runtime drains pending announcements before assembling the system prompt and injects them as a `system` role message:

```text
[subagent #abc123 completed]
goal: "Refactor authentication middleware"
status: succeeded
result: <terminal summary>
```

Delivery uses an idempotency key (taskId) so retried announcements do not duplicate. Failed delivery retries with exponential backoff up to a small bound; persistent failure surfaces as a runtime warning event.

### Context Modes

Two modes for spawning:

- `isolated` (default): the child session is created with a fresh transcript and only the goal + optional context strings.
- `fork`: the parent's message history at spawn time is copied into the child session before the first turn runs. Token cost is higher; appropriate for context-sensitive delegation.

The `SubagentFactory` decides what to copy. By default `fork` includes only assistant + user messages (no tool call records) to keep token use reasonable. The child remains in its own session lane and writes to its own JSONL.

### Depth and Concurrency Policy

Two enforcement layers:

1. Tool list stripping at spawn time. When the factory builds the child's `ExecutableTool[]`, it removes `spawn_subagent`, `spawn_subagent_async`, and `subagents` if `depth >= maxSpawnDepth`. The model literally cannot call them.
2. Lane-based admission control. The subagent lane enforces global parallelism; a per-parent counter inside `GatewayCore` enforces `maxChildrenPerAgent`. Excess submits queue rather than spawn immediately.

Defaults match OpenClaw: `maxSpawnDepth=1`, `maxChildrenPerAgent=5`, subagent lane concurrency 8. All three are configurable via `agents.defaults.subagents.*`.

### Subagent Management Surface

A new `subagents` tool returns an admin surface to parent agents and humans:

```ts
{ command: "list" }                         → { children: [...] }
{ command: "log",   taskId }                → { events: [...] }
{ command: "info",  taskId }                → { record: {...} }
{ command: "kill",  taskId | "all" }        → { stopped: [...] }
{ command: "steer", taskId, message }       → { delivered: bool }
```

`kill` cascades through the session key tree, so killing a depth-1 orchestrator stops every depth-2 child it spawned.

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `multi-agent-runtime.md` rewrite + zh-CN, roadmap update — docs:check must pass.
2. **feat(taskflow)**: add `pendingAnnouncementForParent` field and store helpers; tests.
3. **feat(core)**: push-completion drain in `AgentRuntime.runTurn`; tests with synthetic TaskFlow store.
4. **feat(core,tools)**: `SubagentFactory` options for `contextMode`, `depth`, `parentSessionKey`; `fork` transcript copy; depth-based tool stripping.
5. **feat(gateway)**: per-parent child counter + `maxChildrenPerAgent` admission control; `runTimeoutSeconds` deadline scheduling.
6. **feat(tools,cli)**: `subagents` tool family and `vole subagents` CLI subcommands.
7. **docs**: mark Phase 12 complete.

## 5. Acceptance Criteria

- `pnpm run check` passes at every commit.
- A parent spawning three `async` children sees all three complete announcements automatically delivered on subsequent turns in completion order, with no duplicates.
- A child spawned with `contextMode: "fork"` has access to the parent's prior assistant / user messages.
- A test verifies depth-2 children have no `spawn_subagent*` tools registered.
- A test verifies the 6th concurrent child for one parent is queued, not run.
- `vole subagents kill <id>` stops the named child and any of its descendants within 1 second.
- `runTimeoutSeconds: 5` aborts a runaway child within 6 seconds and surfaces a `timed_out` status.

## 6. Non-Goals

- No process or thread isolation of children.
- No per-child auth or SOUL.md override (Phase 15).
- No streaming of child events into the parent's user-facing event stream.
- No new channel integrations.
- No SQLite TaskFlow store yet (Phase 14).

## 7. Related Documents

- [Phase 11 Gateway and Lanes](./phase-11-gateway-and-lanes.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.md)
- [Task Flow](../architecture/task-flow.md)
- [OpenClaw Alignment Plan](./openclaw-alignment.md)
- [Roadmap](../roadmap/overview.md)

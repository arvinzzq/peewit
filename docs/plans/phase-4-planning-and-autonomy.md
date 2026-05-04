# Phase 4: Planning and Autonomy

Status: Draft
Date: 2026-05-04

Simplified Chinese version: [phase-4-planning-and-autonomy.zh-CN.md](./phase-4-planning-and-autonomy.zh-CN.md)

## Progress

Status: Not Started

Completed: None yet.

Remaining:

- packages/planner: Plan types, Planner interface, ModelBasedPlanner.
- packages/core: Plan events, planner integration in AgentRuntime.
- apps/cli: Plan display, plan-level approval in observe mode.
- Documentation pass.

Next recommended slice:

- Define plan types and Planner interface in packages/planner.

## 1. Purpose

Phase 4 gives ArvinClaw the ability to decompose complex goals into steps before executing them, track step progress visibly, and operate across the three autonomy modes (`observe`, `confirm`, `auto`) with consistent and predictable behavior.

The agent loop in Phase 1–3 already handles multi-step execution through the tool-calling while loop. Phase 4 adds a higher-level planning layer above that: before executing tools, the agent first produces a structured plan the user can review.

Reference: [Agent Loop, Section 12: Planner Evolution](../architecture/agent-loop.md)

## 2. User Result

After Phase 4:

- The user can give the agent a complex multi-step goal (e.g., "summarize all markdown files in this project").
- Before acting, the agent shows a plan: numbered steps, each with a short description.
- In `observe` mode, the user reviews and approves the plan before each step starts.
- In `confirm` mode, the plan displays and execution proceeds automatically unless a tool call needs approval.
- In `auto` mode, planning and execution run without interruption.
- Each step shows progress in `/trace`.
- Step failures are recorded and the agent can attempt recovery.

## 3. Scope

Phase 4 includes:

- `packages/planner`: `Plan`, `PlanStep`, `Planner` interface, `ModelBasedPlanner`.
- New runtime events: `plan_created`, `plan_step_started`, `plan_step_completed`, `plan_step_failed`, `plan_completed`.
- `AgentRuntime` optional `planner` dependency; plan loop wraps the existing tool-calling inner loop.
- CLI plan rendering and plan-level approval in `observe` mode.
- Autonomy mode behavior clarified for plan-level decisions.

Phase 4 does not include:

- Plan persistence across sessions.
- User editing of a generated plan.
- Sub-agent delegation per step.
- Parallel step execution.
- Plan version history.
- Streaming model output (Phase 6).

## 4. Architecture

### 4.1 Plan Types

```typescript
// packages/planner
export type PlanStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  result?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface Planner {
  createPlan(goal: string, context: PlannerContext): Promise<Plan>;
}

export interface PlannerContext {
  systemInstruction: string;
  availableTools: string[];
}
```

### 4.2 ModelBasedPlanner

`ModelBasedPlanner` uses the model provider and a special system instruction to generate a structured plan.

The planner calls the model once with a `create_plan` tool definition. The model returns a tool call with the plan steps as input. This approach is more reliable than parsing free-text responses.

```typescript
export class ModelBasedPlanner implements Planner {
  // inject ModelProvider
  async createPlan(goal: string, context: PlannerContext): Promise<Plan>
}
```

The `create_plan` tool:
```json
{
  "name": "create_plan",
  "description": "Produce a step-by-step plan to accomplish the user goal.",
  "parameters": {
    "type": "object",
    "properties": {
      "steps": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Ordered list of step descriptions."
      }
    },
    "required": ["steps"]
  }
}
```

### 4.3 AgentRuntime Integration

`AgentRuntime` gains an optional `planner?: Planner` dependency.

When a planner is provided, `runTurn()` becomes:

```text
runTurn(goal):
  → planner.createPlan(goal)
  → emit plan_created
  → [observe mode: emit plan_approval_requested; await approval]
  → for each step in plan:
    → emit plan_step_started
    → run inner agent loop for step.description
    → emit plan_step_completed or plan_step_failed
  → emit plan_completed (or plan_failed)
  → emit run_completed
```

When no planner is provided, `runTurn()` behaves exactly as in Phase 3 (backward compatible).

### 4.4 New Runtime Events

```typescript
interface PlanCreatedEvent extends RuntimeEventBase {
  type: "plan_created";
  plan: Plan;
}

interface PlanApprovalRequestedEvent extends RuntimeEventBase {
  type: "plan_approval_requested";
  plan: Plan;
}

interface PlanApprovalResolvedEvent extends RuntimeEventBase {
  type: "plan_approval_resolved";
  planId: string;
  approved: boolean;
}

interface PlanStepStartedEvent extends RuntimeEventBase {
  type: "plan_step_started";
  planId: string;
  step: PlanStep;
}

interface PlanStepCompletedEvent extends RuntimeEventBase {
  type: "plan_step_completed";
  planId: string;
  step: PlanStep;
}

interface PlanStepFailedEvent extends RuntimeEventBase {
  type: "plan_step_failed";
  planId: string;
  step: PlanStep;
  error: { message: string };
}

interface PlanCompletedEvent extends RuntimeEventBase {
  type: "plan_completed";
  planId: string;
}
```

### 4.5 Autonomy Mode Behavior

| Event | observe | confirm | auto |
| --- | --- | --- | --- |
| `plan_created` | pause, show plan, ask approval | show plan, auto-proceed | auto-proceed |
| `plan_step_started` | pause, show step | show step | silent |
| tool call (low risk) | ask | allow | allow |
| tool call (medium risk) | ask | ask | allow |
| tool call (high risk) | ask | ask | ask |
| tool call (blocked) | deny | deny | deny |

`observe` mode adds plan-level pauses on top of the existing tool-call approval flow.

### 4.6 CLI Plan Rendering

The CLI renders:

```
Plan: summarize all markdown files
  1. List markdown files in the project  [pending]
  2. Read each file                      [pending]
  3. Write a summary for each            [pending]

Proceed? [y/N]
```

During execution, the step status updates:

```
  1. List markdown files in the project  [complete]
  2. Read each file                      [running...]
  3. Write a summary for each            [pending]
```

Step rendering should use the compact trace output path. Full Ink-based live updates are deferred to Phase 6 (streaming).

## 5. Learning Documents

Update:

- `docs/architecture/agent-loop.md` — planner evolution section
- `docs/architecture/runtime-composition.md` — planner in composition

## 6. Acceptance Criteria

Phase 4 is complete when:

- `packages/planner` exports `Plan`, `PlanStep`, `Planner`, and `ModelBasedPlanner`.
- `ModelBasedPlanner` generates a structured plan by calling the model with a `create_plan` tool.
- `AgentRuntime` accepts an optional `planner` dependency.
- When a planner is provided, `runTurn()` emits `plan_created`, `plan_step_started`, `plan_step_completed`, and `plan_completed` events.
- In `observe` mode, the CLI prompts for plan approval before executing steps.
- Each plan step executes using the existing inner agent loop.
- Step failures are recorded in trace without terminating the whole plan.
- No planner means `runTurn()` behaves exactly as in Phase 3 (backward compatible).
- All tests pass and `pnpm run check` succeeds.

## 7. Non-Goals

- No plan persistence across sessions.
- No user editing of a generated plan before execution.
- No plan branching or conditional steps.
- No sub-agent spawning.
- No parallel step execution.
- No live terminal UI updates (Phase 6 / Ink).

## 8. Planned Work

Recommended order:

### Part A: Planner Package

1. Create `packages/planner` with `Plan`, `PlanStep`, `Planner`, `PlannerContext` types.
2. Implement `ModelBasedPlanner` with `create_plan` tool injection.
3. Add `packages/planner` source header, README, AGENTS.
4. Add planner tests using a fake model provider.

### Part B: Runtime Integration

1. Add plan event types to `packages/core`.
2. Add `planner?: Planner` to `AgentRuntimeDependencies`.
3. Implement plan loop in `AgentRuntime.runTurn()`.
4. Update `packages/core` source header and module docs.
5. Add runtime plan event tests.

### Part C: CLI Plan Rendering

1. Add plan display to CLI (`plan_created`, step progress).
2. Add plan approval handling in `observe` mode.
3. Update CLI help text and `/trace` to show plan events.
4. Update `apps/cli` source header and module docs.
5. Add CLI plan display tests.

### Documentation Pass

1. Update `agent-loop.md` planner evolution section.
2. Update roadmap Phase 4 status.
3. Update README.

## 9. Tests

Required Phase 4 tests:

- `ModelBasedPlanner` generates a plan from the model's `create_plan` tool call.
- Plan with no steps produces a graceful result.
- Each plan step triggers inner agent loop execution.
- Step failures are recorded without terminating the plan.
- `observe` mode emits `plan_approval_requested` before execution.
- `confirm` mode proceeds without plan approval request.
- `auto` mode proceeds without plan approval or pause.
- Plan events appear in compact trace output.
- No planner → same event sequence as Phase 3.

## 10. Commit Plan

Suggested commits:

1. `feat(planner): add Plan types and ModelBasedPlanner`
2. `feat(core): add plan events and planner integration to AgentRuntime`
3. `feat(cli): add plan display and observe-mode plan approval`
4. `docs: update agent-loop and complete phase 4`

## 11. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Agent Loop](../architecture/agent-loop.md)
- [Permission System](../architecture/permission-system.md)
- [CLI Adapter](../architecture/cli-adapter.md)
- [Runtime Composition](../architecture/runtime-composition.md)

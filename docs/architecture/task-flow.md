# TaskFlow

Status: Design
Date: 2026-05-11

Simplified Chinese version: [task-flow.zh-CN.md](./task-flow.zh-CN.md)

> **Phase 14 update**: a new `SqliteTaskFlowStore` joins `JsonlTaskFlowStore` under the same `TaskFlowStore` interface, with indexes on `status`, `parentId`, `runtime`, and `createdAt`. The new store also fits the read-modify-write pattern used by `drainPendingForParent` (Phase 12) more naturally — a single SQL UPDATE clears the mailbox column instead of rewriting the whole file. See [Phase 14 plan](../plans/phase-14-sqlite-storage-unification.md).

## 1. Purpose

`update_todos` gives the model in-turn task visibility for a single run. It shows the user what the agent is doing right now — but it vanishes when the session ends.

TaskFlow fills the persistent coordination layer. It is a durable, cross-session task graph that tracks the lifecycle of long-running goals from creation through completion, failure, or cancellation — across any number of sessions and agent runs.

TaskFlow is designed for:

- Multi-step projects that span days or weeks
- Goals that pause and resume across sessions
- Background tasks that run while the user is offline
- Parent/child task decomposition (one goal, many subtasks)
- Audit trails: what was attempted, what succeeded, what failed

The core rule:

`update_todos` is in-turn display. TaskFlow is persistent coordination. They serve different purposes and do not replace each other.

## 2. TaskRecord Type

A `TaskRecord` represents a single atomic unit of work:

```typescript
interface TaskRecord {
  /** Unique identifier for this task. */
  taskId: string;

  /** ID of the AgentRuntime session that owns this task. */
  runtime: string;

  /** Human-readable description of what this task does. */
  task: string;

  /** Current lifecycle status. */
  status: TaskStatus;

  /** Rolling summary of progress, updated by the agent during execution. */
  progressSummary: string;

  /** Final outcome summary, set when status reaches a terminal state. */
  terminalSummary: string | null;

  /** ISO timestamp of creation. */
  createdAt: string;

  /** ISO timestamp of last update. */
  updatedAt: string;
}
```

## 3. TaskFlow Type

A `TaskFlow` represents a higher-level goal that may decompose into multiple `TaskRecord` steps:

```typescript
interface TaskFlow {
  /** Unique identifier for this flow. */
  flowId: string;

  /** The top-level goal description. */
  goal: string;

  /** ID of the TaskRecord currently executing (null if waiting or not started). */
  currentStep: string | null;

  /** Summary of why the flow is blocked, if status is "blocked". */
  blockedSummary: string | null;

  /** Arbitrary JSON state the agent can read and write across sessions. */
  stateJson: string;

  /** Parent flow ID if this is a sub-flow. */
  parentFlowId: string | null;

  /** IDs of direct child flows. */
  childFlowIds: string[];

  /** Current lifecycle status. */
  status: TaskStatus;

  /** ISO timestamp of creation. */
  createdAt: string;

  /** ISO timestamp of last update. */
  updatedAt: string;
}
```

`stateJson` is a freeform JSON blob the agent can use to persist intermediate results, open questions, or partial outputs between sessions.

## 4. Status Lifecycle

Both `TaskRecord` and `TaskFlow` share the same status type:

```typescript
type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";
```

Status transitions:

```
queued → running → succeeded
                 → failed
                 → cancelled
       → waiting → running
                 → cancelled
       → blocked → running (after unblocking)
                 → cancelled

Any non-terminal → lost  (if the agent process died without completing)
```

Terminal statuses (`succeeded`, `failed`, `cancelled`, `lost`) cannot transition to other statuses.

`lost` is set by the runtime during recovery when a `running` task has no active session and no recent heartbeat.

## 5. Modes

TaskFlow supports two coordination modes:

### Managed Mode

The TaskFlow drives execution. The runtime reads the current step from `TaskFlow.currentStep`, starts a session for it, runs to completion, updates the step status, and advances to the next step.

Managed mode is appropriate for:

- Autonomous multi-step projects
- Background automation flows
- Scheduled recurring goals

### Mirrored Mode

TaskFlow observes and records an externally-driven execution. The agent updates TaskFlow state as it completes steps, but the flow does not drive agent startup.

Mirrored mode is appropriate for:

- Manual sessions where the user wants persistent progress tracking
- Integrations where another system drives execution order

## 6. Storage

Initial implementation uses JSONL files per flow in the workspace under `.vole/flows/`:

```
.vole/
  flows/
    <flowId>.jsonl   # one append-only event log per flow
```

Each line in the JSONL file is a state transition event. The current state is computed by replaying events from the log.

Future: migrate to SQLite for indexed queries, efficient status lookups, and cross-flow relationship queries.

The storage module interface is:

```typescript
interface TaskFlowStore {
  createFlow(flow: TaskFlow): Promise<void>;
  getFlow(flowId: string): Promise<TaskFlow | null>;
  updateFlow(flowId: string, patch: Partial<TaskFlow>): Promise<void>;
  listFlows(filter?: { status?: TaskStatus }): Promise<TaskFlow[]>;
  createRecord(record: TaskRecord): Promise<void>;
  getRecord(taskId: string): Promise<TaskRecord | null>;
  updateRecord(taskId: string, patch: Partial<TaskRecord>): Promise<void>;
}
```

## 7. Relationship to update_todos

`update_todos` and TaskFlow serve different roles:

| Dimension | `update_todos` | TaskFlow |
| --- | --- | --- |
| Persistence | In-memory for the turn | Durable across sessions |
| Scope | Current run only | Multiple sessions, multiple runs |
| Visibility | CLI display during execution | CLI, Web, background query |
| Driver | Model (tool call) | Runtime scheduler or model |
| Recovery | None (ephemeral) | Lost detection + resume |
| Structure | Flat list of steps | Tree of flows and records |

The two systems can coexist: `update_todos` provides live in-run visibility while TaskFlow tracks the durable state of the larger goal.

## 8. OpenClaw Alignment

OpenClaw implements a persistent task graph similar to TaskFlow. Key alignments:

| OpenClaw concept | Vole equivalent |
| --- | --- |
| `TaskRecord` with status lifecycle | `TaskRecord` type |
| `TaskFlow` with parent/child | `TaskFlow` type with `parentFlowId`/`childFlowIds` |
| JSONL event log storage | `.vole/flows/<flowId>.jsonl` |
| SQLite migration path | Planned in future phase |
| `lost` state for dead sessions | `"lost"` status |
| `stateJson` for cross-session state | `stateJson: string` field |

OpenClaw's implementation confirms that JSONL is the correct starting point: simple, human-readable, and easy to migrate.

## 9. Acceptance Criteria

TaskFlow is considered complete when:

- `TaskRecord` and `TaskFlow` types are implemented and stored in JSONL.
- Status lifecycle transitions are enforced (no invalid transitions).
- `lost` status is assigned during recovery when running tasks have no active session.
- Managed mode drives session startup for `queued` steps.
- Mirrored mode allows agent to update flow state without runtime scheduling.
- Parent/child flow relationships are stored and queryable.
- `TaskFlowStore` interface is implemented for JSONL.
- Unit tests cover: status transitions, lost detection, JSONL event replay, parent/child linking.

## 10. Related Documents

- [Agent Loop](./agent-loop.md)
- [Background Automation](./background-automation.md)
- [Run Queue](./run-queue.md)
- [Session Storage](./session-storage.md)
- [Execution Trace](./execution-trace.md)
- [Multi-Agent Runtime](./multi-agent-runtime.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Roadmap](../roadmap/overview.md)

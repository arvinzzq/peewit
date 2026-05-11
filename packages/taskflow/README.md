# TaskFlow Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/taskflow` owns the **persistent cross-session task graph**: it stores and queries task records that span multiple sessions, adapters, and runtime types. Where `@vole/sessions` stores conversation history within a session, `@vole/taskflow` tracks the lifecycle of individual tasks across all sessions.

```
spawn_subagent_async  ──creates──▶
CronScheduler         ──creates──▶   JsonlTaskFlowStore   ←── task graph (JSONL)
CLI task command      ──creates──▶
```

## Core Concepts

### TaskRecord

```typescript
interface TaskRecord {
  id: string;
  runtime: TaskRuntime;       // "subagent" | "background" | "cli" | "cron" | "web"
  task: string;               // goal description
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  progressSummary?: string;   // in-progress status description
  terminalSummary?: string;   // final result description
  parentId?: string;          // links to parent task for sub-task hierarchies
  sessionId?: string;         // associated session ID if applicable
  pendingAnnouncement?: PendingAnnouncement;  // Phase 12: push-to-parent mailbox
}
```

### TaskStatus

Nine terminal and non-terminal states:

| Status | Terminal? | Meaning |
|---|---|---|
| `"queued"` | No | Created, not yet started |
| `"running"` | No | Currently executing |
| `"waiting"` | No | Paused, waiting for dependency or approval |
| `"blocked"` | No | Cannot proceed (dependency failed) |
| `"succeeded"` | Yes | Completed successfully |
| `"failed"` | Yes | Completed with failure |
| `"timed_out"` | Yes | Aborted because `runTimeoutSeconds` elapsed |
| `"cancelled"` | Yes | Explicitly cancelled |
| `"lost"` | Yes | Process died before recording a terminal status |

### PendingAnnouncement

```typescript
interface PendingAnnouncement {
  taskId: string;
  goal: string;
  status: "succeeded" | "failed" | "timed_out";
  terminalSummary?: string;
  completedAt: string;
}
```

When an async sub-agent reaches a terminal state, the runtime writes a `PendingAnnouncement` to the child's `TaskRecord.pendingAnnouncement` field. The parent's next `runTurn` calls `drainPendingForParent(parentId)` to atomically read all pending announcements for its children and clear them in one read-modify-write pass. Each announcement is then injected as a `system` role message before the parent's prompt is assembled.

Idempotency: the `taskId` doubles as an idempotency key. Once `drainPendingForParent` clears a field, the same announcement cannot be delivered twice.

### TaskRuntime

`"subagent"` | `"background"` | `"cli"` | `"cron"` | `"web"` — identifies how the task was initiated, useful for filtering and display.

### TaskFlowStore

```typescript
interface TaskFlowStore {
  create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord>;
  update(id: string, updates: TaskUpdate): Promise<TaskRecord | undefined>;
  get(id: string): Promise<TaskRecord | undefined>;
  list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]>;
  drainPendingForParent(parentId: string): Promise<PendingAnnouncement[]>;
}
```

`TaskUpdate` accepts mutable fields (`status`, `progressSummary`, `terminalSummary`, `pendingAnnouncement`) plus a sentinel `clearPendingAnnouncement: true` to remove the mailbox entry explicitly. Structural fields (`id`, `runtime`, `task`, `parentId`, `sessionId`) are immutable after creation.

`drainPendingForParent(parentId)` atomically reads and clears every `pendingAnnouncement` for children of the given parent in a single read-modify-write pass. This is the parent runtime's mailbox-drain entry point.

## Implementation Principles

### JsonlTaskFlowStore: Read-Modify-Write

Unlike `JsonlSessionStore` (which is append-only), `JsonlTaskFlowStore` uses a **read-modify-write** pattern for updates. Every `update()` call:

1. Reads all records from the JSONL file.
2. Finds the record with the matching ID.
3. Merges the updates and bumps `updatedAt`.
4. Rewrites the entire file.

This allows status changes to be reflected in the file without maintaining a separate index. The tradeoff is O(n) update cost, which is acceptable for task lists expected to hold hundreds of records.

`create()` appends a new record line and immediately rewrites the full file (including the new record) for consistent format. The parent directory is created automatically.

### Parent/Child Task Graph

The `parentId` field enables tree-structured task tracking for sub-agent spawning:

```
parent task (cli)
  └── sub-task A (subagent, parentId = parent.id)
  └── sub-task B (subagent, parentId = parent.id)
        └── sub-sub-task (subagent, parentId = sub-task-B.id)
```

`list({ parentId: "…" })` returns all direct children of a task. Full subtree traversal requires multiple queries.

### Push-Completion Mailbox

The `pendingAnnouncement` field on `TaskRecord` plus the `drainPendingForParent` store method together form the push-based completion channel for async sub-agents (Phase 12):

1. When an async sub-agent reaches a terminal state, its runtime calls `update(childId, { status, terminalSummary, pendingAnnouncement })`.
2. The parent's next `runTurn` calls `drainPendingForParent(parentId)` before assembling the prompt. The store atomically reads all pending announcements for the parent's children and clears the `pendingAnnouncement` field on each.
3. Each drained announcement is injected as a `system` role message describing the completed child.

Atomicity matters: the read-modify-write happens inside one `#readAll` / `#writeAll` cycle, so a child writing `pendingAnnouncement` concurrently with a parent draining cannot lose the announcement (the in-process JavaScript event loop serializes them). Cross-process atomicity is not guaranteed; this is acceptable today because async sub-agents only run from the same process that drains them.

### Difference from scheduler's JsonlTaskStore

`@vole/scheduler` has its own `JsonlTaskStore` for scheduler-specific `TaskRunRecord` objects (which include `assistantText`, `completedAt`, and are tightly coupled to the scheduler's run lifecycle). `@vole/taskflow`'s `JsonlTaskFlowStore` stores `TaskRecord` objects with a richer status model and parent/child relationships for general-purpose cross-session task graphs. The two stores serve different layers: scheduler tracks execution history, taskflow tracks the logical task graph.

### Integration with AsyncTaskStore

`@vole/core` defines a duck-typed `AsyncTaskStore` interface that `createSpawnSubagentAsyncTool` uses to record task IDs when spawning async sub-agents. `JsonlTaskFlowStore` satisfies this interface (it has a `create()` method with compatible shape), so callers can pass a `JsonlTaskFlowStore` instance as the `taskStore` option without an explicit adapter.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the taskflow package and exports. |
| `tsconfig.json` | TypeScript config | Builds the taskflow package (no workspace package dependencies). |
| `src/index.ts` | Task flow store | All exports: `TaskStatus` (now includes `timed_out`), `AnnouncementStatus`, `TaskRuntime`, `TaskRecord` (with optional `pendingAnnouncement`), `PendingAnnouncement`, `TaskUpdate`, `TaskFlowStore` (with `drainPendingForParent`), `JsonlTaskFlowStore`, `taskflowPackageName`. |
| `src/index.test.ts` | TaskFlow tests | Protects create with timestamps, update/get/list, status and parentId filtering, limit, `undefined` on missing ID, plus the Phase 12 `pendingAnnouncement` lifecycle (set on update, atomic drain, explicit clear). |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

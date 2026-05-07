# Scheduler Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/scheduler` owns the **background task execution boundary**: task run record persistence, safe approval policy for unattended execution, and cron-based task scheduling. It sits between the agent runtime and the file system, bridging the gap between a live interactive session and long-running background work.

```
CronScheduler (timer-based)
    │  calls runner
    ▼
TaskRunner (caller-provided, typically runs AgentRuntime)
    │  persists to
    ▼
JsonlTaskStore    ←── task run history (JSONL file)
    │
BackgroundApprovalResolver  ←── injected into AgentRuntime for unattended runs
```

## Core Concepts

### TaskDefinition

A `TaskDefinition` describes a named agent task, optionally with a cron schedule:

```typescript
interface TaskDefinition {
  name: string;
  goal: string;              // the user message sent to AgentRuntime
  cron?: string;             // "minute hour dom month dow" (5-field standard)
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

The `cron` field uses standard 5-field cron syntax (`* * * * *`). When `cron` is absent, the task is a one-shot run triggered explicitly by the caller.

### TaskRunRecord

A persisted record of one task execution:

```typescript
interface TaskRunRecord {
  id: string;
  taskName: string;
  goal: string;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  assistantText: string;
  errorMessage?: string;
}
```

### JsonlTaskStore

Persists task run records to a single JSONL file. Each line is one `TaskRunRecord` serialized as JSON.

- **`saveRun`**: appends a new record line (append-only, no rewrite).
- **`updateRun`**: reads all records, finds the matching ID, merges updates, and rewrites the entire file. This is correct for small task histories; a full database would be needed at scale.
- **`listRuns`**: reads all records, optionally filters by `taskName`, and applies `limit` from the tail.

The parent directory is created automatically (`mkdir -p`) before the first write.

### BackgroundApprovalResolver

Unattended background tasks cannot present interactive approval prompts. `BackgroundApprovalResolver` implements `ApprovalResolver` with a simple rule:

| Mode | Decision |
|---|---|
| `"auto"` | `approved: true` — auto-approves all tool calls |
| `"confirm"` (default) | `approved: false` — auto-denies; no user present |
| `"observe"` | `approved: false` — auto-denies; no user present |

When the agent runtime calls `approvalResolver.resolve()` for a tool that requires approval, `BackgroundApprovalResolver` returns immediately without blocking on user input. This prevents background tasks from hanging indefinitely.

**Design implication**: background tasks that need to run shell commands or write files should use `mode: "auto"`. Tasks running in `"confirm"` mode will fail as soon as they try to call a medium/high-risk tool.

### matchesCron

```typescript
function matchesCron(expression: string, date: Date): boolean
```

Parses a 5-field cron expression (`minute hour dom month dow`) and returns `true` if the given `Date` matches. Only exact values and `*` wildcards are supported (no step values like `*/5`, no ranges). This intentionally simple implementation covers the common scheduling needs (hourly, daily, weekly) without adding a dependency on a cron parser library.

### CronScheduler

Polls for due tasks on a configurable interval (default: 30 seconds):

```typescript
class CronScheduler {
  constructor(tasks: TaskDefinition[], runner: TaskRunner, options?: CronSchedulerOptions)
  start(): void   // begins polling, runs once immediately
  stop(): void    // clears the interval
  get isRunning(): boolean
}
```

**Per-minute deduplication**: The scheduler tracks the last run time for each task as a `minuteKey` (Unix timestamp floored to whole minutes). If a task's `minuteKey` matches the current minute, it is skipped. This prevents the 30-second poll interval from running a task twice within the same minute.

**Failure isolation**: If `runner(task)` throws, the error is silently caught. The scheduler continues processing remaining tasks and does not stop.

The `getNow` function is injectable for testing deterministic time-based behavior.

## Implementation Principles

### Why JSONL for Task Runs

Task runs are append-heavy (new records constantly added) and read occasionally (for the last N runs of a task). JSONL is a natural fit: appending is O(1), and reading all records for listing is straightforward. Unlike session JSONL, task run updates require a full rewrite because run status changes in place (`running` → `completed`). This is acceptable because task histories are expected to be small (hundreds of records, not millions).

### Why Scheduler Is Separate from Core

The scheduler contains background-specific logic (cron matching, unattended approval) that would add background-task complexity to the core runtime. The scheduler imports `ApprovalResolver` from `@vole/core` but does not import `AgentRuntime` — it operates on `TaskRunner`, a caller-provided function that the CLI wires to an `AgentRuntime` instance. This keeps the dependency direction clean.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the scheduler package with workspace dependencies on `@vole/core` and `@vole/sessions`. |
| `tsconfig.json` | TypeScript config | Builds the scheduler package with project references to core and sessions. |
| `src/index.ts` | Scheduler | All exports: `TaskDefinition`, `TaskRunRecord`, `TaskStore`, `JsonlTaskStore`, `BackgroundApprovalResolver`, `matchesCron`, `CronScheduler`, `CronSchedulerOptions`, `TaskRunner`. |
| `src/index.test.ts` | Scheduler tests | Protects task store CRUD, `BackgroundApprovalResolver` mode behavior, `matchesCron` wildcard and exact matching, and `CronScheduler` start/stop/deduplication/isolation. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

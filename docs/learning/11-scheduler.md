# Module 10: @vole/scheduler

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `11-scheduler.zh-CN.md`

Related source: `packages/scheduler/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [08-sessions.md](./08-sessions.md) — the scheduler uses `JsonlSessionStore`
and `AgentRuntime`, so those concepts need to be solid first.

**Before reading**: Read `packages/scheduler/src/index.ts` in full (207 lines). There are
four exports: `TaskDefinition`, `JsonlTaskStore`, `BackgroundApprovalResolver`, and
`CronScheduler`. Notice that none of them knows about the others — assembly happens in CLI.

**Focus questions**:
- `saveRun` appends; `updateRun` reads-modifies-writes. Why the asymmetry?
- `BackgroundApprovalResolver` has three modes but only two outcomes. What are they, and
  which mode maps to which?
- `CronScheduler` ticks every 30 seconds. Can a cron task run twice per minute?
  Trace the exact code path.
- `matchesCron("*/5 * * * *", now)` — what does this return and why?

**Checkpoint**: You understand this module when you can describe the full flow from a
`.task.json` file on disk to a completed `TaskRunRecord` entry in `task-runs.jsonl`,
and explain why `BackgroundApprovalResolver` is needed at all.

## 1. What This Module Does

**Plain language**: Think of the scheduler as a night watchman. During the day (interactive
sessions), the human is present and approves every significant action. At night (background
tasks), the watchman handles things autonomously — but with different rules depending on
how much trust was granted: observe-only, confirm-that-always-denies, or full auto. The
module provides the tools the night watchman needs: a logbook (`JsonlTaskStore`), a
standing approval policy (`BackgroundApprovalResolver`), and a timer that calls him at the
right minute (`CronScheduler`).

**Technical summary**: `@vole/scheduler` provides three orthogonal primitives for background
agent execution. `JsonlTaskStore` persists task run records (status, output, timing) to a
JSONL file. `BackgroundApprovalResolver` implements `ApprovalResolver` for unattended runs
by applying a fixed policy: auto-approve in `auto` mode, auto-deny in `confirm` or `observe`
mode. `CronScheduler` calls a `TaskRunner` callback on a cron schedule, using 30-second
polling with per-minute deduplication. The CLI wires all three together into `runDaemonTask`.

## 2. Why It Exists

Without a scheduler, Vole is purely reactive — it only acts when a human sends a message.
Many useful tasks are time-driven: daily summaries, hourly health checks, periodic research
updates. The scheduler adds a push model: tasks that fire based on a clock, not a human.

Background execution also requires a different approval posture. Interactive sessions have
a human who can answer "yes, run that command". Background sessions do not. The
`BackgroundApprovalResolver` makes the approval policy explicit at construction time rather
than at the point of each tool call — the mode is decided before execution starts.

## 3. Public Interface

```ts
// A task loaded from a .task.json file or passed directly
interface TaskDefinition {
  name: string
  goal: string
  cron?: string              // standard 5-field cron expression
  mode?: "observe" | "confirm" | "auto"
  maxSteps?: number
}

// One execution of a task
interface TaskRunRecord {
  id: string
  taskName: string
  goal: string
  sessionId: string
  startedAt: string          // ISO 8601
  completedAt?: string
  status: "running" | "completed" | "failed"
  assistantText: string      // final assistant response text
  errorMessage?: string
}

interface TaskStore {
  saveRun(record: TaskRunRecord): Promise<void>
  updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>
  listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>
}

class JsonlTaskStore implements TaskStore { ... }

class BackgroundApprovalResolver implements ApprovalResolver {
  constructor(mode?: "observe" | "confirm" | "auto")  // default: "confirm"
  resolve(request: ApprovalRequest): Promise<ApprovalResolution>
}

function matchesCron(expression: string, date: Date): boolean

type TaskRunner = (task: TaskDefinition) => Promise<void>

class CronScheduler {
  constructor(tasks: TaskDefinition[], runner: TaskRunner, options?: CronSchedulerOptions)
  start(): void
  stop(): void
  get isRunning(): boolean
}
```

## 4. Implementation Walkthrough

### Task lifecycle: two-phase write

The task record is written twice. First, at the moment execution starts:

```ts
const initialRecord = { id, taskName, goal, sessionId, startedAt, status: "running", assistantText: "" }
await taskStore.saveRun(initialRecord);  // append to JSONL
```

Then, after `runTurn` completes:

```ts
await taskStore.updateRun(runId, { status, assistantText, completedAt, errorMessage? })
```

`saveRun` appends a new line — fast and append-only. `updateRun` reads the entire file,
patches the matching record by `id`, and rewrites the whole file. This asymmetry exists
because:

- **Save**: records are created once and never need merging — pure append is correct.
- **Update**: mutable state (status transitions from `running` → `completed`/`failed`) must
  overwrite the original record in-place.

This is different from `@vole/sessions` where all JSONL records are immutable events.
TaskRunRecords are entity state, not an event log.

### BackgroundApprovalResolver: policy at construction time

```ts
async resolve(_request: ApprovalRequest): Promise<ApprovalResolution> {
  if (this.#mode === "auto") {
    return { approved: true, reason: "Auto-approved in background auto mode." };
  }
  return { approved: false, reason: `Auto-denied in background ${this.#mode} mode: no user is present...` };
}
```

Three modes, two outcomes:
- `auto` → approve everything
- `confirm` → deny everything (the request would need a human, but there is none)
- `observe` → deny everything (read-only intent, side effects are blocked)

The `_request` parameter is ignored entirely — the decision is determined at construction,
not by the tool call details. This is intentional: background tasks commit to a mode before
they start, not on a per-tool basis.

### CronScheduler: 30s polling with minuteKey deduplication

```ts
async #tick(): Promise<void> {
  const now = this.#getNow();
  for (const task of this.#tasks) {
    if (!task.cron) continue;
    if (!matchesCron(task.cron, now)) continue;

    const lastRun = this.#lastRun.get(task.name) ?? 0;
    const minuteKey = Math.floor(now.getTime() / 60_000);
    if (lastRun === minuteKey) continue;        // already ran this minute

    this.#lastRun.set(task.name, minuteKey);
    try {
      await this.#runner(task);
    } catch { /* individual failure doesn't stop scheduler */ }
  }
}
```

The scheduler ticks every 30 seconds (default), but `minuteKey` (`ms / 60_000` floored)
ensures each task runs at most once per minute. The 30-second interval is a reliability
choice: if one tick happens to miss the clock change from `:59` to `:00`, the next tick 30
seconds later will catch it.

### matchesCron: minimal syntax only

```ts
function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return ( matchesCronField(min, date.getMinutes()) && ... );
}
```

Supported: `*` (wildcard) and exact integers. Unsupported: `*/5` (step), `1-5` (range),
`1,3,5` (list). This means `*/5 * * * *` does NOT run every 5 minutes — the `*/5` field
fails `parseInt`, returns `NaN`, and the function returns `false` for every minute.

The supported set covers the most common background schedules: `0 9 * * *` (daily at 9am),
`0 * * * *` (hourly), `* * * * *` (every minute for testing).

### How tasks are stored on disk

Tasks live in a `tasks/` directory alongside the sessions directory:

```
~/.vole/sessions/task-runs.jsonl
~/.vole/tasks/daily-summary.task.json
~/.vole/tasks/hourly-health.task.json
```

Each `.task.json` is a single `TaskDefinition` object:

```json
{
  "name": "daily-summary",
  "goal": "Read today's sessions and write a one-paragraph summary to notes/daily.md",
  "cron": "0 22 * * *",
  "mode": "auto",
  "maxSteps": 10
}
```

`loadTaskDefinitions` reads all `*.task.json` files in the directory. The daemon filters
to only the subset with `cron` defined.

### CLI wiring: runDaemonTask

The CLI's `runDaemonTask` function assembles all three primitives into one execution:

```
TaskDefinition
  → BackgroundApprovalResolver(task.mode ?? "auto")
  → AgentRuntime({ approvalResolver, tools, modelProvider, ... })
  → runtime.runTurn({ sessionId, message: task.goal })
  → collect events
  → taskStore.updateRun(runId, { status, assistantText })
```

Each background run gets its own `sessionId` and `AgentRuntime` instance — there is no
session reuse between runs. The `preferStreaming: false` flag is set because there is no
terminal to render to.

## 4b. Heartbeat Mechanism

The `HEARTBEAT.md` mechanism provides liveness signalling for background tasks. It has two independent write paths:

**System layer** (`@vole/scheduler` → CLI): `writeHeartbeat(filePath, state)` is called by `runDaemonTask` at task start and end. This write always happens, regardless of what the agent does.

```ts
// task start
await writeHeartbeat(heartbeatPath, { status: "running", taskName, runId, lastUpdatedAt })

// task end
await writeHeartbeat(heartbeatPath, { status, taskName, runId, lastUpdatedAt, message? })
```

**Agent layer** (`@vole/tools`): the `update_heartbeat` tool lets the agent write intermediate status during long tasks:

```
update_heartbeat({ status: "running", message: "Processed 3 of 10 files." })
```

The resulting file content is human-readable Markdown and is injected into the next session's context via `workspacePromptFiles`. The agent can read the previous run's final status without any special tool.

**Why two layers?** The system write is a safety net: if the agent fails, panics, or never calls `update_heartbeat`, the daemon still records the final outcome. The agent write enables granular progress reporting for long tasks.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Background task execution with approval policy | `BackgroundApprovalResolver` | Same three modes |
| Task run persistence | `JsonlTaskStore` | OpenClaw uses SQLite; Vole uses JSONL |
| Cron scheduling with deduplication | `CronScheduler` + `minuteKey` | Identical concept |
| Task definition files | `.task.json` in `tasks/` | OpenClaw uses TOML; Vole uses JSON |
| Daemon mode (scheduler + signal handling) | `runDaemon` in CLI | Same SIGTERM/SIGINT pattern |

## 6. Key Design Decisions

**Approval policy decided at construction, not per-call**

`BackgroundApprovalResolver` ignores the `ApprovalRequest` contents and returns a fixed
answer based on `mode`. This means the policy is declared once (when the background run
starts) rather than evaluated per tool call. The benefit: clear, auditable behaviour.
A `confirm` mode task will never approve a tool call, regardless of what the tool is.

**Two-phase JSONL write: append then rewrite**

Saving a new run is pure append; updating an existing run rewrites the file. This is
correct because `TaskRunRecord` is an entity (it has an id and mutable state), not an
event. Append-only would require a tombstone-and-replay scheme to reconstruct current
state, which adds complexity with no benefit for a small file.

**30-second tick + minuteKey, not exact scheduling**

An interval timer can drift or miss ticks under load. The 30-second tick gives two chances
to catch each minute boundary. The `minuteKey` guard prevents double execution if both
ticks happen to fall within the same minute. This is simpler and more reliable than
attempting to calculate exact next-fire times.

**`matchesCron` supports only `*` and exact integers**

The minimal syntax covers all practical daily-use schedules. Supporting step (`*/5`) and
range (`1-5`) would require a more complex parser with edge cases. Since these patterns are
not needed for Vole's current built-in tasks, they are deferred. The risk: a user who
writes `*/30 * * * *` expecting "every 30 minutes" will get silence with no error message.

**No InMemory variant for TaskStore**

`JsonlTaskStore` tests use real temporary directories. The store is simple enough that a
real filesystem test is cheaper than maintaining a fake. This contrasts with `@vole/sessions`
where `InMemorySessionStore` was added for test isolation — the session store has more
complex interactions that benefit from a controlled in-memory implementation.

## 7. Testing Approach

Tests are in `packages/scheduler/src/index.test.ts`. All three components are tested:

- **`JsonlTaskStore`**: save/list, multiple records, limit filter, taskName filter,
  updateRun patches correct record, missing file returns empty, creates parent directories
- **`BackgroundApprovalResolver`**: confirm denies, observe denies, auto approves,
  default (no arg) denies like confirm
- **`matchesCron`**: wildcard matches any date, specific minute+hour, wrong hour returns
  false, invalid expression (wrong field count) returns false
- **`CronScheduler`**: runs task when cron matches, does not run twice in same minute
  (deduplication), skips non-matching cron, start/stop lifecycle

`CronScheduler` tests use `getNow` injection to control the clock without real timers.

## 8. Insights

**The scheduler decouples scheduling from execution.** `CronScheduler` knows nothing about
`AgentRuntime`, sessions, or tools. It calls a `TaskRunner` callback — what that callback
does is entirely up to the caller. This makes the scheduler trivially testable: inject a
`vi.fn()` and verify it was called once.

**`BackgroundApprovalResolver` enforces the contract that background runs can't block.**
Interactive sessions block on `ApprovalResolver.resolve()` waiting for user input.
Background sessions must never block. `BackgroundApprovalResolver` resolves immediately
with a deterministic answer, so `AgentRuntime` never waits on a human.

**The task record is the audit trail.** `TaskRunRecord` captures the `assistantText`,
`status`, `completedAt`, and `errorMessage` for every background run. Even if the session
JSONL is later compacted or deleted, the task store preserves a human-readable summary of
what the agent did and whether it succeeded. This is the background equivalent of the
conversation history.

**`once` mode in the daemon enables cron-job-style use.** `runDaemon(options, once=true)`
runs all cron tasks once immediately and exits — no scheduler, no signal handling. This
allows the system clock (Linux cron, launchd) to be the actual scheduler, with Vole as
the executor. The built-in `CronScheduler` is for environments where running a persistent
daemon is more convenient than configuring system cron.

## 9. Review Questions

1. `saveRun` appends; `updateRun` rewrites. Why not make both append-only?
   > `TaskRunRecord` is mutable entity state (the status changes from `running` to
   > `completed`). Append-only would require replaying all records to find the current
   > state of any given run, adding complexity. The file is small (one record per execution),
   > so rewriting it is cheap. In contrast, sessions JSONL is append-only because session
   > events are immutable — they are never updated in place.

2. A task is in `confirm` mode. During execution, the agent calls the `shell` tool. The
   permissions module returns `ask`. What happens?
   > `BackgroundApprovalResolver.resolve()` is called. Because mode is `confirm` (not
   > `auto`), it returns `{ approved: false }` immediately without reading the request.
   > `AgentRuntime` receives the denial and the tool call fails. The run continues but the
   > shell command was never executed. After all steps, `status` is `completed` (not
   > `failed`) — unless the failure caused a downstream error that propagated to
   > `run_failed`.

3. `matchesCron("*/5 * * * *", now)` — what does this return?
   > `false` for every value of `now`. `matchesCronField("*/5", minutes)` calls
   > `parseInt("*/5", 10)` which returns `NaN`. The `!isNaN(num)` guard fails, so the
   > field never matches. The expression is silently invalid — `matchesCron` returns
   > `false` as if the expression never matched, not an error.

4. Can a cron task run twice in the same minute?
   > No. `#tick()` computes `minuteKey = Math.floor(now.getTime() / 60_000)` and checks
   > it against `#lastRun`. If the task already ran in this minute, it is skipped. The
   > `#lastRun` map persists in memory for the lifetime of the `CronScheduler` instance.

5. What is `once` mode in `runDaemon` and when would you use it?
   > `once=true` runs all cron-bearing tasks once immediately and exits. Use it when the
   > system scheduler (cron, launchd) handles timing — Vole becomes a one-shot executor
   > rather than a persistent daemon. The built-in `CronScheduler` is only started when
   > `once=false`.

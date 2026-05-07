# Module 08: @vole/taskflow

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `09-taskflow.zh-CN.md` (create alongside this file)

Related source: `packages/taskflow/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [08-sessions.md](./08-sessions.md) — both use JSONL storage, but with a
key difference in write strategy: sessions appends, taskflow rewrites.

**Before reading**: Read `packages/taskflow/src/index.ts` in full. It is short (103 lines).
Notice the eight `TaskStatus` values and the five `TaskRuntime` values.

**Focus questions**:
- What is the difference between `progressSummary` and `terminalSummary`?
- Why does `update()` rewrite the entire file instead of appending?
- What does `parentId` enable, and what does it not enforce?
- How does `limit` work — does it return the first N or the last N records?

**Checkpoint**: You understand this module when you can describe what a `tasks.jsonl` file
looks like after three task creations and one status update, and explain why the update
triggers a full file rewrite.

## 1. What This Module Does

**Plain language**: Think of `@vole/taskflow` as a whiteboard on the wall of a control
room. Every job that's been submitted — whether it's running right now, waiting in a queue,
or already finished — gets a card on that whiteboard. You can look at the cards to see
what's happening, add new cards, or flip a card over to update its status. Unlike a journal
(where you never erase entries), the whiteboard keeps current state: if a task finishes,
you update its card — you don't add a new card.

**Technical summary**: `@vole/taskflow` persists cross-session task records to a flat JSONL
file. Each line is one `TaskRecord`. Unlike `@vole/sessions` which is append-only,
`JsonlTaskFlowStore` uses a **read-modify-write** strategy: every `update()` reads all
records, mutates the target record in memory, and rewrites the whole file. This keeps each
task as a single authoritative line reflecting current state.

## 2. Why It Exists

Sessions track conversation history — what was said. Taskflow tracks task state — what was
done, what's running, and what failed. These are different concerns with different update
semantics.

A conversation history grows forward: you always append. A task status is a mutable entity:
`queued → running → succeeded`. If tasks were stored as append-only events, reading current
state would require replaying all status transitions for every task — a join-like operation
across events. Taskflow avoids this by keeping one record per task with the current state.

Taskflow also models sub-tasks via `parentId`, supporting multi-agent workflows where a
parent task spawns children and tracks their outcomes.

## 3. Public Interface

```ts
type TaskStatus =
  | "queued"      // waiting to start
  | "running"     // actively executing
  | "waiting"     // paused, waiting for an external signal
  | "blocked"     // cannot proceed (dependency unmet or error)
  | "succeeded"   // completed successfully
  | "failed"      // completed with error
  | "cancelled"   // explicitly stopped
  | "lost"        // runtime died without reporting outcome

type TaskRuntime = "subagent" | "background" | "cli" | "cron" | "web"

interface TaskRecord {
  id: string
  runtime: TaskRuntime
  task: string           // goal / description (free text)
  status: TaskStatus
  createdAt: string
  updatedAt: string
  progressSummary?: string    // live progress — updated during execution
  terminalSummary?: string    // final outcome — set on completion or failure
  parentId?: string           // parent task ID for sub-tasks
  sessionId?: string          // associated session ID
}

interface TaskFlowStore {
  create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord>
  update(id: string, updates: Partial<Pick<TaskRecord, "status" | "progressSummary" | "terminalSummary">>): Promise<TaskRecord | undefined>
  get(id: string): Promise<TaskRecord | undefined>
  list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]>
}
```

One implementation: `JsonlTaskFlowStore` (no in-memory variant).

## 4. Implementation Walkthrough

### Storage format

A `tasks.jsonl` file looks like this after two task creations:

```jsonl
{"id":"task_1","runtime":"cli","task":"Write the report","status":"running","createdAt":"...","updatedAt":"..."}
{"id":"task_2","runtime":"subagent","task":"Research the topic","status":"queued","createdAt":"...","updatedAt":"...","parentId":"task_1"}
```

Each line is one complete `TaskRecord`. There is no envelope type (`"type"` field) — unlike
sessions, every line is always a task record.

### Read-modify-write on update

```ts
async update(id, updates) {
  const all = await this.#readAll()           // 1. read all records from file
  const idx = all.findIndex(r => r.id === id) // 2. find the target record
  if (idx === -1) return undefined
  const updated = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  all[idx] = updated                           // 3. mutate in memory
  await this.#writeAll(all)                   // 4. rewrite entire file
  return updated
}
```

This is the opposite of the session replay pattern. Sessions never mutate existing lines;
taskflow replaces the entire file on every write.

### `#readAll()` is silent on missing file

```ts
async #readAll() {
  try {
    const content = await readFile(this.#filePath, "utf-8")
    return content.split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l))
  } catch {
    return []  // file doesn't exist yet
  }
}
```

Any error (including `ENOENT`) returns an empty array. The first `create()` call will
create the file via `#writeAll()`.

### Limit returns last N, not first N

```ts
if (query?.limit !== undefined) records = records.slice(-query.limit)
```

`slice(-N)` returns the last N records — the most recently created tasks. This matches the
common UI expectation: "show me the last 10 tasks" returns the most recent, not the oldest.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Task graph / job queue | `JsonlTaskFlowStore` | OpenClaw uses a database with indexes; Vole uses flat JSONL |
| Task status state machine | `TaskStatus` (8 values) | Similar terminal states (succeeded, failed, cancelled) |
| Sub-agent tasks | `parentId` on `TaskRecord` | OpenClaw models task trees similarly |
| `lost` status | `TaskStatus = "lost"` | Handles crash recovery — runtime died without reporting |

OpenClaw's task store supports indexed queries (filter by status, by parent, with pagination).
Vole's `JsonlTaskFlowStore` supports the same filter shapes but implements them with
in-memory filter passes after reading all records.

## 6. Key Design Decisions

**Read-modify-write, not append-only**

Sessions use append-only writes because conversation history is an immutable log — you
never go back and change what was said. Tasks are mutable entities — their status changes
as they execute. Using read-modify-write keeps each task as a single authoritative record
with current state. Reading current state is O(1) per task (find by id) rather than O(N)
replay across events.

The tradeoff: a rewrite is not atomic. If the process crashes mid-write, the file could be
corrupt. Sessions' append-only design avoids this because old lines are never touched.
Taskflow accepts this risk because task state is recoverable (a crashed task can be marked
`lost` on next startup), but conversation history cannot be reconstructed.

**`lost` as an explicit terminal status**

`"lost"` means the runtime that was executing the task died without reporting an outcome.
It is not the same as `"failed"` (which means the task ran to completion and produced an
error). On next startup, the system can query for `status: "running"` tasks from before
the crash and transition them to `"lost"`, making crash recovery explicit and auditable.

**`progressSummary` vs `terminalSummary`**

These are two distinct fields for two distinct phases:
- `progressSummary`: updated during execution to provide live status ("Wrote 3 of 7 files")
- `terminalSummary`: set once at completion or failure ("Completed in 4.2s, wrote 7 files" / "Failed: rate limit exceeded")

Separating them prevents terminal results from being overwritten by in-progress updates,
and lets UIs display different information while a task is running vs after it finishes.

**`parentId` creates a tree, not a DAG**

`parentId` is a simple string reference — no graph traversal is enforced by the store.
A task can reference any other task as its parent, including one that doesn't exist yet or
has already finished. The store does not validate parent existence, enforce parent-child
lifecycle coupling, or prevent cycles. Those constraints, if needed, live in the caller.

**No in-memory implementation**

`@vole/sessions` has an `InMemorySessionStore` for tests. The sessions package has
enough internal complexity — replay, `compact_boundary` handling, `updatedAt` derivation
— that a clean in-memory implementation makes those tests easier to write and reason
about. In production, `JsonlSessionStore` is always used; `InMemorySessionStore` only
appears in the `createFake()` factory method, which is a test-only path.

`@vole/taskflow` has no equivalent because `JsonlTaskFlowStore` already handles the
missing-file case gracefully (`#readAll()` returns `[]` when the file does not exist,
and the first `create()` transparently creates it). Test setup is therefore nearly as
cheap as an in-memory store — a temporary directory from `mkdtemp` is the only setup
required. There is no logic complex enough to warrant a separate in-memory implementation.

## 7. Testing Approach

Tests are in `packages/taskflow/src/index.test.ts`. All tests use a real temporary
directory with a real `.jsonl` file — no mocking.

Test categories:
- Task creation with auto-generated timestamps
- Status update and `updatedAt` refresh
- `update()` returns `undefined` for unknown ID
- `get()` by ID and missing ID
- `list()` — all records
- `list({ status })` — filter by status
- `list({ parentId })` — sub-task tree
- `list({ limit })` — last N records (not first N)

## 8. Insights

**Taskflow and sessions are complementary persistence layers.** Sessions track what the
agent said and did (conversation history + trace events). Taskflow tracks what work exists
and what state it is in (task graph). A session is ephemeral — it ends when the conversation
ends. A task may outlive its session — a background task created in one session may complete
in another.

**The `runtime` field is a classification, not a routing key.** `TaskRuntime` records where
a task was created (`cli`, `web`, `cron`) or how it executes (`subagent`, `background`).
It is metadata for filtering and display — it does not determine how the task is dispatched.

**The file is not append-only — this is intentional but means it has different crash
characteristics.** A crashed append-only write leaves previous records intact. A crashed
rewrite could leave the file partially written. In practice, `writeFile` on modern operating
systems either completes or fails atomically at the OS level (via rename), but the
implementation does not use `fs.rename` — it writes directly. This is an accepted limitation
for the current scale.

**`limit` slices from the end.** `records.slice(-query.limit)` means `list({ limit: 5 })`
returns the 5 most recently created tasks. This is consistent with "show me recent work"
but surprising if you expect "show me the first 5 created." Read the implementation before
assuming limit semantics.

## 9. Review Questions

1. What is the difference between `progressSummary` and `terminalSummary`?
   > `progressSummary` is a live update written during execution ("Processed 3 of 7 items").
   > `terminalSummary` is a final outcome written once when the task completes or fails.
   > They serve different UIs: progress for "what is happening now", terminal for "what
   > was the result."

2. Why does `update()` rewrite the entire file instead of appending?
   > Tasks are mutable entities with a single authoritative current state. If updates were
   > appended, reading current state would require replaying all transitions for every task.
   > Read-modify-write keeps one record per task with the current status, making reads O(1)
   > per task lookup rather than O(N) replay.

3. What does the `"lost"` status mean? How is it different from `"failed"`?
   > `"failed"` means the task ran to completion and produced an error outcome.
   > `"lost"` means the runtime that was executing the task died (crashed or was killed)
   > without reporting any outcome. On restart, tasks stuck in `"running"` from before
   > the crash can be transitioned to `"lost"` to make crash recovery explicit.

4. What does `parentId` enable, and what does the store enforce about it?
   > `parentId` enables a tree of sub-tasks — a parent task can spawn children that are
   > tracked independently. The store enforces nothing: it does not validate that the
   > parent exists, does not cascade status changes, and does not prevent cycles. Lifecycle
   > enforcement is the caller's responsibility.

5. When you call `list({ limit: 3 })`, which records do you get?
   > The last 3 records added (by insertion order in the file). `slice(-3)` returns the
   > tail of the array. This returns the most recently created tasks, not the oldest.

6. What happens when the `tasks.jsonl` file doesn't exist and you call `create()`?
   > `#readAll()` catches the `ENOENT` error and returns `[]`. The new record is appended
   > to this empty array, then `#writeAll()` creates the file (and any parent directories)
   > before writing. The first `create()` call transparently bootstraps the file.

# Task Queue

Status: Draft
Date: 2026-05-05

Simplified Chinese version: [task-queue.zh-CN.md](./task-queue.zh-CN.md)

## 1. Purpose

The task queue stores task run history and task definitions so background tasks are inspectable and recoverable.

This document describes the `TaskStore` interface, `JsonlTaskStore` implementation, task definition files (future), and CLI task commands.

## 2. TaskStore Interface

```ts
interface TaskStore {
  saveRun(record: TaskRunRecord): Promise<void>;
  updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>;
  listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>;
}
```

`TaskStore` is the persistence contract for task runs. It is separate from `SessionStore` because task runs have different metadata (status, taskName, goal) and a different query pattern (list by task name, list by status).

## 3. TaskRunRecord

```ts
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

Each `TaskRunRecord` links to a `sessionId` so the full trace can be retrieved from `JsonlSessionStore`. The `assistantText` field is a compact summary; the full trace lives in the session file.

## 4. JsonlTaskStore

`JsonlTaskStore` is the JSONL-backed implementation of `TaskStore`.

- File path: provided at construction time. Typically `{sessionsDirectory}/task-runs.jsonl`.
- Format: one JSON record per line (append-only for saves; full rewrite for updates).
- `saveRun`: appends a new record. Creates parent directories if missing.
- `updateRun`: reads all records, updates the matching record by `id`, rewrites the file.
- `listRuns`: reads all records, filters by `taskName` if provided, returns last N (default all).

```ts
class JsonlTaskStore implements TaskStore {
  constructor(filePath: string)
  async saveRun(record: TaskRunRecord): Promise<void>
  async updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>
  async listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>
}
```

The JSONL format is chosen for the same reasons as `JsonlSessionStore`: human-readable, appendable, and resilient to partial writes.

## 5. Task Definition Files

Phase 8 does not implement file-based task definitions. Task goals are passed directly as CLI arguments.

A future file format might look like:

```yaml
# .peewit/tasks/daily-summary.yaml
name: daily-summary
goal: "Summarize the changes made to the workspace today."
mode: confirm
maxSteps: 8
```

The `TaskDefinition` interface is designed to support this extension:

```ts
interface TaskDefinition {
  name: string;
  goal: string;
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

## 6. CLI Task Commands

### run command

```
peewit run "<goal>"
peewit run "<goal>" --mode auto|confirm
```

The `run` command:

1. Parses the goal from the first non-flag argument.
2. Parses `--mode` (default: `confirm`).
3. Calls `runBackgroundTask(goal, mode, options)`.
4. Prints a compact trace to stdout.
5. Prints `Done: <assistantText>` on success.
6. Exits 0 on success, 1 on failure.

### tasks command

```
peewit tasks
peewit tasks --limit N
```

The `tasks` command:

1. Opens `JsonlTaskStore` at `{sessionsDirectory}/task-runs.jsonl`.
2. Lists runs (filtered by `--limit` if provided).
3. Prints one line per run: `<id-suffix>  <taskName>  <status>  <startedAt>`.
4. Prints "No task runs found." if the store is empty.

## 7. Separation from Session Store

Task runs and sessions are kept separate because they serve different purposes:

| Concern | SessionStore | TaskStore |
| --- | --- | --- |
| Format | Per-session JSONL files | Single flat JSONL file |
| Query | By session ID | By task name, by limit |
| Contents | Full conversation + trace | Task summary + status |
| Audience | Developer / trace inspection | User / task monitoring |

A `TaskRunRecord` includes a `sessionId` so the full trace can always be retrieved from `JsonlSessionStore` when needed.

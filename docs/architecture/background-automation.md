# Background Automation

Status: Draft
Date: 2026-05-05

Simplified Chinese version: [background-automation.zh-CN.md](./background-automation.zh-CN.md)

## 1. Purpose

Background automation lets Peewit run agent tasks without a foreground user connection.

This document describes the background adapter concept, `BackgroundApprovalResolver`, task definition format, task run lifecycle, and the direction toward a full daemon.

## 2. Background Adapter Concept

An adapter connects a user-facing surface to Agent Core. Background tasks are a special case: the "surface" is a scheduled invocation, not a human interaction.

The background adapter:

- Accepts a `TaskDefinition` instead of interactive user input.
- Runs a single agent turn with the task goal as the user message.
- Collects all runtime events and persists them as a trace.
- Returns an exit code: 0 for success, 1 for failure.

Its `AdapterCapabilities` is `BACKGROUND_CAPABILITIES`:

```ts
{ streaming: false, approvalPrompts: false, background: true }
```

The background adapter cannot show streaming output or interactive approval prompts because there is no user present during execution.

## 3. BackgroundApprovalResolver

The `BackgroundApprovalResolver` implements the `ApprovalResolver` interface from `@peewit/core`.

When `AgentRuntime` encounters a tool that requires user confirmation (`decision.decision === "ask"`), it calls the resolver. The background resolver's behavior depends on the autonomy mode:

```
mode = "auto"     → auto-approve (approved: true)
mode = "confirm"  → auto-deny   (approved: false)
mode = "observe"  → auto-deny   (approved: false)
```

In `auto` mode, the agent is trusted to call only appropriate tools without user intervention. In `confirm` and `observe` modes, there is no user to consult, so the resolver denies the request and the run fails safely.

This design keeps `AgentRuntime` unaware of the execution context. The same `AgentRuntime` that drives interactive chat also drives background tasks — only the resolver changes.

### Interface

```ts
class BackgroundApprovalResolver implements ApprovalResolver {
  constructor(mode?: "observe" | "confirm" | "auto")
  async resolve(request: ApprovalRequest): Promise<ApprovalResolution>
}
```

## 4. Task Definition Format

A `TaskDefinition` is a plain data object that describes one unit of work:

```ts
interface TaskDefinition {
  name: string;          // human-readable name for listing
  goal: string;          // the agent's user message
  mode?: "observe" | "confirm" | "auto";  // autonomy mode (default: confirm)
  maxSteps?: number;     // override default step limit
}
```

For Phase 8, task definitions are passed as CLI arguments. Future extensions may load them from YAML or JSON files.

## 5. Task Run Lifecycle

Each invocation of `peewit run` follows this lifecycle:

```
1. Load config and resolve sessions directory.
2. Create JsonlSessionStore for session/trace persistence.
3. Create JsonlTaskStore for task run records.
4. Generate a session ID and task run ID.
5. Save initial task run record (status: running).
6. Construct BackgroundApprovalResolver(mode).
7. Construct AgentRuntime with the resolver and goal.
8. Call runtime.runTurn({ message: goal }) and collect events.
9. Print compact trace to stdout.
10. Determine final status from events (completed vs failed).
11. Update task run record with status, assistantText, completedAt.
12. Exit 0 on success, exit 1 on failure.
```

The session file at step 2 stores the full conversation and trace using the existing `JsonlSessionStore` format. The task run record at step 5 stores task-specific metadata separately in `task-runs.jsonl`.

## 6. Trace Persistence

Background tasks produce the same runtime events as interactive chat. The events are persisted to the session store as trace records. The compact trace is also printed to stdout during the run so that CI and cron logs capture the output.

Task run records in `task-runs.jsonl` provide a lightweight summary view separate from the full session trace:

```json
{"id":"run_abc","taskName":"test","goal":"do thing","sessionId":"session_xyz","startedAt":"...","status":"completed","assistantText":"Done!"}
```

## 7. Daemon Direction

Phase 8 implements the one-shot execution path. A future daemon would:

1. Maintain a task queue (JSONL or SQLite).
2. Poll or respond to triggers (cron, file watch, webhook).
3. Pick up tasks from the queue and call the same one-shot execution logic.
4. Manage concurrency (e.g., one task at a time per workspace).
5. Expose a health endpoint for monitoring.

The one-shot path designed in Phase 8 is intentionally composable so daemon wrappers can use it without changes.

## 8. Safety Principles

Background tasks follow the same permission policy as interactive chat.

- Low-risk tools run automatically regardless of mode.
- Medium and high-risk tools require confirmation: in background mode with `confirm` or `observe`, this means auto-deny.
- Blocked tools are always denied.
- In `auto` mode, the `BackgroundApprovalResolver` approves ask-level decisions.

Background tasks should never gain more privilege than an attended session. The `auto` mode is an explicit opt-in by the user when defining the task.

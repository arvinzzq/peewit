# Phase 8 Background Automation Plan

Status: In Progress
Date: 2026-05-05

Simplified Chinese version: [phase-8-background-automation.zh-CN.md](./phase-8-background-automation.zh-CN.md)

## Progress

Status: In Progress

Planned commits:

- [ ] Part A: Design docs — background automation and task queue
- [ ] Part B: `packages/scheduler` — task store, task definition types, and BackgroundApprovalResolver
- [ ] Part C: `apps/cli` — `run` and `tasks` commands for background task execution
- [ ] Part D: Mark Phase 8 complete

## 1. Purpose

Phase 8 adds background task execution to ArvinClaw.

Phases 1–7 proved that the agent can run interactively in a terminal or browser session. Phase 8 extends the agent to run tasks without a foreground user connection.

The minimal implementation:

- A one-shot background `run` command that executes a task goal.
- A `BackgroundApprovalResolver` that enforces safe execution policy when no user is present.
- A `JsonlTaskStore` that persists task run history for inspection.
- A `tasks` command that lists completed, failed, and running task runs.

## 2. Scope

This phase includes:

- `packages/scheduler`: new package exporting `TaskDefinition`, `TaskRunRecord`, `TaskStore`, `JsonlTaskStore`, and `BackgroundApprovalResolver`.
- `apps/cli`: `run "<goal>"` command for one-shot background task execution and `tasks` command for listing task run history.
- Design documents for background automation and task queue architecture.
- Bilingual documentation for all new content.

This phase does not include:

- Daemon process management.
- Cron scheduling.
- Event trigger interface.
- Multi-step task orchestration.
- Task cancellation.
- Remote task dispatch.
- Plugin-defined task types.
- Enterprise workflow engine.

## 3. Architecture Summary

### Background Adapter Concept

A background adapter runs agent tasks without a live user connection. It cannot show streaming output or interactive approval prompts. Its `AdapterCapabilities` is `BACKGROUND_CAPABILITIES = { streaming: false, approvalPrompts: false, background: true }`.

Because no user is present, the background adapter replaces the interactive `ApprovalResolver` with a `BackgroundApprovalResolver` that enforces a safe default policy.

### BackgroundApprovalResolver

The `BackgroundApprovalResolver` controls what happens when a tool requires user confirmation during unattended execution.

```
mode = "auto"     → auto-approve ask-level decisions
mode = "confirm"  → auto-deny (no user present)
mode = "observe"  → auto-deny (no user present)
```

In `auto` mode, the resolver trusts the model to request only appropriate tools. In `confirm` and `observe` modes, the resolver denies any tool requiring interactive approval because there is no user to consult.

This resolver integrates with the existing `ApprovalResolver` interface in `@arvinclaw/core`. No changes to `AgentRuntime` are required.

### Task Definition Format

Tasks are defined as structured configuration objects:

```ts
interface TaskDefinition {
  name: string;
  goal: string;
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

For Phase 8, task definitions are passed directly to the `run` command as arguments. File-based task definitions are a future extension.

### Task Run Lifecycle

```
run command invoked
  → create task run record (status: running)
  → create AgentRuntime with BackgroundApprovalResolver
  → call runTurn({ message: goal })
  → collect events
  → print compact trace
  → update task run record (status: completed | failed)
  → exit 0 on success, exit 1 on failure
```

Each run produces:

- A session file in the sessions directory (standard JSONL session format).
- A task run record in `task-runs.jsonl` (task-specific metadata and status).

### Daemon Direction

Full daemon mode (Phase 8+) would manage a background process that picks up scheduled tasks from a queue. Phase 8 implements the one-shot execution path that daemons would use internally. A future daemon wrapper can call the same `runBackgroundTask` logic on a schedule.

## 4. Commit Sequence

1. **docs**: design docs (this file + zh-CN + architecture docs) — docs:check must pass.
2. **feat(scheduler)**: `packages/scheduler` — `JsonlTaskStore` + `BackgroundApprovalResolver` + tests.
3. **feat(cli)**: `apps/cli` — `run` and `tasks` commands.
4. **docs**: mark Phase 8 complete.

## 5. Acceptance Criteria

- `arvinclaw run "<goal>"` executes a task and prints a compact trace.
- `arvinclaw run "<goal>" --mode auto` uses auto-approval policy.
- `arvinclaw tasks` lists recent task runs with status.
- Background tasks persist run records to `task-runs.jsonl`.
- Dangerous actions follow permission policy in background mode.
- Failed background tasks are visible in `arvinclaw tasks` output.

## 6. Non-Goals

- No daemon process.
- No cron scheduling.
- No event trigger interface.
- No fully autonomous unrestricted execution.
- No enterprise workflow engine.
- No multi-agent coordination.

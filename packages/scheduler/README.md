# Scheduler Package

## Architecture Summary

This directory owns the background task execution boundary.
It stores task run records in JSONL, implements safe approval policy for unattended execution, provides task definition types for background and scheduled tasks, and runs cron-scheduled tasks via `CronScheduler`.
It keeps background task persistence, approval policy, and cron scheduling separate from runtime orchestration and UI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the scheduler package, package exports, build scripts, and workspace dependencies on core and sessions. |
| `tsconfig.json` | TypeScript config | Builds the scheduler package with references to core and sessions. |
| `src/index.ts` | Scheduler | Exports `TaskDefinition` (with optional `cron` field), `TaskRunRecord`, `TaskStore`, `JsonlTaskStore`, `BackgroundApprovalResolver`, `matchesCron`, `CronScheduler`, `CronSchedulerOptions`, and `TaskRunner`. Task run records are persisted to a JSONL file. The approval resolver auto-denies in confirm/observe mode and auto-approves in auto mode. `CronScheduler` polls at a configurable interval and runs tasks whose cron expression matches the current time, preventing duplicate runs within the same minute. |
| `src/index.test.ts` | Scheduler tests | Protects task run save, list, update, taskName filtering, limit queries, parent directory creation, BackgroundApprovalResolver mode behavior, matchesCron wildcard and specific matching, and CronScheduler start/stop lifecycle, per-minute deduplication, and non-matching cron skipping. |

## Update Reminder

Update this file when the directory structure changes.

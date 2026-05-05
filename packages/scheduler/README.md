# Scheduler Package

## Architecture Summary

This directory owns the background task execution boundary.
It stores task run records in JSONL, implements safe approval policy for unattended execution, and provides task definition types for background and scheduled tasks.
It keeps background task persistence and approval policy separate from runtime orchestration and UI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the scheduler package, package exports, build scripts, and workspace dependencies on core and sessions. |
| `tsconfig.json` | TypeScript config | Builds the scheduler package with references to core and sessions. |
| `src/index.ts` | Scheduler | Exports `TaskDefinition`, `TaskRunRecord`, `TaskStore`, `JsonlTaskStore`, and `BackgroundApprovalResolver`. Task run records are persisted to a JSONL file. The approval resolver auto-denies in confirm/observe mode and auto-approves in auto mode. |
| `src/index.test.ts` | Scheduler tests | Protects task run save, list, update, taskName filtering, limit queries, parent directory creation, and BackgroundApprovalResolver mode behavior. |

## Update Reminder

Update this file when the directory structure changes.

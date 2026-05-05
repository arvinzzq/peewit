# TaskFlow Package

## Architecture Summary

This directory owns the persistent cross-session task graph boundary.
It stores task records across sessions, tracks task lifecycle state, and supports parent/child relationships for sub-task hierarchies.
It keeps task graph persistence separate from runtime orchestration, session storage, and CLI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the taskflow package, package exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the taskflow package with a reference to sessions. |
| `src/index.ts` | Task flow store | Exports `TaskRecord`, `TaskStatus`, `TaskRuntime`, `TaskFlowStore` interface, and `JsonlTaskFlowStore` with create, update, get, and list operations. |
| `src/index.test.ts` | TaskFlow tests | Protects task record creation with timestamps, status updates, undefined on missing id, get by id, list all records, filter by status, filter by parentId, and limit. |

## Update Reminder

Update this file when the directory structure changes.

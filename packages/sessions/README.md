# Sessions Package

## Architecture Summary

This directory reserves the session persistence boundary.
It will store conversations, turns, traces, and future replay data.
It keeps persistence separate from runtime orchestration and UI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the sessions package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the sessions package. |
| `src/index.ts` | Package boundary | Exports the current package marker and future session API surface. |

## Update Reminder

Update this file when the directory structure changes.

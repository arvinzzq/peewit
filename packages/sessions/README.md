# Sessions Package

## Architecture Summary

This directory reserves the session persistence boundary.
It stores short-term conversation records and prepares for durable traces and future replay data.
It keeps persistence separate from runtime orchestration and UI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the sessions package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the sessions package. |
| `src/index.ts` | Session store | Exports session/message contracts and in-memory short-term session storage. |
| `src/index.test.ts` | Session tests | Protects session creation, message ordering, recent-message queries, and defensive copies. |

## Update Reminder

Update this file when the directory structure changes.

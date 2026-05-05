# Sessions Package

## Architecture Summary

This directory owns the session persistence boundary.
It stores short-term conversation records, durable JSONL sessions, durable trace events, and prepares for future replay data.
It keeps persistence separate from runtime orchestration and UI rendering.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the sessions package, package exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the sessions package. |
| `src/index.ts` | Session store | Exports session, message, and trace contracts plus in-memory and JSONL session storage with session listing. |
| `src/index.test.ts` | Session tests | Protects session creation, session listing order, message ordering, trace persistence, recent queries, defensive copies, JSONL replay, and unsafe session ID rejection. |

## Update Reminder

Update this file when the directory structure changes.

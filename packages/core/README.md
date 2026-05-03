# Core Package

## Architecture Summary

This directory owns the agent runtime orchestration layer.
It coordinates context assembly, short-term conversation context, model provider calls, structured runtime events, and trace storage contracts.
It must stay adapter-agnostic and vendor-agnostic.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the core package and workspace dependencies. |
| `tsconfig.json` | TypeScript config | Builds core with references to context and models. |
| `src/index.ts` | Runtime core | Exports runtime event contracts, in-memory trace store, and message-only `AgentRuntime` with recent-message context input. |
| `src/index.test.ts` | Runtime tests | Protects event vocabulary, terminal-event detection, trace storage, recent-message context flow, and message-only run flow. |

## Update Reminder

Update this file when the directory structure changes.

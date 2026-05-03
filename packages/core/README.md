# Core Package

## Architecture Summary

This directory owns the agent runtime orchestration layer.
It coordinates context assembly, short-term conversation context, model provider calls, model-requested tool-call events, structured runtime events, and trace storage contracts.
It must stay adapter-agnostic and vendor-agnostic.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the core package and workspace dependencies. |
| `tsconfig.json` | TypeScript config | Builds core with references to context and models. |
| `src/index.ts` | Runtime core | Exports runtime event contracts, in-memory trace store, message run flow, and tool-call request events. |
| `src/index.test.ts` | Runtime tests | Protects event vocabulary, terminal-event detection, trace storage, recent-message context flow, message run flow, and tool-call request behavior. |

## Update Reminder

Update this file when the directory structure changes.

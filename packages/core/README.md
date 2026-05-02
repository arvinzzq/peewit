# Core Package

## Architecture Summary

This directory owns the agent runtime orchestration layer.
It coordinates context assembly, model provider calls, and structured runtime events.
It must stay adapter-agnostic and vendor-agnostic.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the core package and workspace dependencies. |
| `tsconfig.json` | TypeScript config | Builds core with references to context and models. |
| `src/index.ts` | Runtime core | Exports runtime event contracts and message-only `AgentRuntime`. |
| `src/index.test.ts` | Runtime tests | Protects event vocabulary, terminal-event detection, and message-only run flow. |

## Update Reminder

Update this file when the directory structure changes.

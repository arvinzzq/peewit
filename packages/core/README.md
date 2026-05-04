# Core Package

## Architecture Summary

This directory owns the agent runtime orchestration layer.
It coordinates context assembly, short-term conversation context, model provider calls, model-requested tool-call events, permission evaluation events, approval resolution events, executable tool calls, structured runtime events, and trace storage contracts.
It must stay adapter-agnostic and vendor-agnostic.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the core package and workspace dependencies, including context, models, permissions, and tools. |
| `tsconfig.json` | TypeScript config | Builds core with references to context, models, permissions, and tools. |
| `src/index.ts` | Runtime core | Exports runtime event contracts, in-memory trace store, real agent loop (while loop with maxSteps), tool definition projection, tool-call request events, permission evaluation events, approval resolver contracts, and tool lifecycle events. |
| `src/index.test.ts` | Runtime tests | Protects event vocabulary, terminal-event detection, trace storage, recent-message context flow, message run flow, tool-call request behavior, runtime permission policy injection, approval resolver behavior, tool execution, multi-round tool-calling loop, tool definition handoff, and step-limit enforcement. |

## Update Reminder

Update this file when the directory structure changes.

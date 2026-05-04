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
| `src/index.ts` | Runtime core | Exports runtime event contracts including `token_delta`, `todos_updated`, and `planning_stall_detected` events, in-memory trace store, agent loop with optional streaming path (`preferStreaming`), built-in `update_todos` injection, planning stall detection with retry injection, tool summary projection, default permission guidance, tool-call request events, permission evaluation events, approval resolver contracts, and tool lifecycle events. |
| `src/index.test.ts` | Runtime tests | Protects event vocabulary (including `token_delta`), terminal-event detection, trace storage, context flow, message run flow, tool-call behavior, permission policy, approval resolver, tool execution, multi-round loop, step limit, planning stall detection, `todos_updated` event emission, and streaming path (token_delta emission with `preferStreaming`, no-delta with default). |

## Update Reminder

Update this file when the directory structure changes.

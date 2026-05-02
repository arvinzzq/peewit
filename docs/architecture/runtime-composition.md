# Runtime Composition

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [runtime-composition.zh-CN.md](./runtime-composition.zh-CN.md)

## 1. Purpose

Runtime composition defines how an ArvinClaw application entry point wires together configuration, model providers, tools, permissions, context, sessions, trace, and Agent Core.

Core rule:

Application startup composes dependencies. Agent Core runs behavior.

## 2. Why This Module Exists

Without an explicit composition layer, setup logic tends to leak into the wrong places:

- CLI starts reading model-specific environment variables.
- Agent Core starts constructing providers.
- Tools start reading global config directly.
- Permission logic starts mixing with terminal prompts.
- Session storage gets coupled to one adapter.

Runtime composition prevents that drift.

## 3. MVP Composition Flow

Phase 0 and Phase 1 should use a simple single-process composition flow:

```text
CLI startup
  -> Load and validate configuration
  -> Resolve workspace
  -> Create trace sink
  -> Create session store
  -> Create model provider
  -> Create tool registry
  -> Create permission policy
  -> Create context assembler
  -> Create agent runtime
  -> Start CLI adapter loop
```

The exact factory names can change during implementation, but the dependency direction should remain stable.

## 4. Composition Ownership

The CLI entry point may own application startup, but it should delegate setup details to package APIs.

| Concern | Owned By | Notes |
| --- | --- | --- |
| Config loading | `packages/config` | CLI calls loader, but does not parse files itself |
| Provider creation | Application composition | Uses `packages/models` factories |
| Tool registration | Application composition | Uses `packages/tools` registry |
| Permission policy | `packages/permissions` | CLI only renders approval prompts |
| Context assembly | `packages/context` | CLI never builds prompts directly |
| Session store | `packages/sessions` | CLI does not write session files directly |
| Trace sink | `packages/sessions` or `packages/core` boundary | Trace events are structured |
| Agent runtime | `packages/core` | Receives configured dependencies |

## 5. Dependency Direction

Recommended direction:

```text
apps/cli
  -> packages/config
  -> packages/models
  -> packages/tools
  -> packages/permissions
  -> packages/context
  -> packages/sessions
  -> packages/core
```

`packages/core` should depend on interfaces and domain types, not adapter-specific startup code.

## 6. Effective Configuration

Composition starts by loading effective configuration.

The effective configuration should decide:

- Provider type
- Provider settings
- Workspace root
- Default autonomy mode
- Enabled tool categories
- Trace verbosity
- Session storage location

Secret values should be resolved only for the components that need them.

## 7. Workspace Resolution

The workspace root should be resolved before tools and context are created.

The resolved workspace should be passed to:

- File tools
- Shell tool
- Context assembler
- Workspace file loader
- Permission policy
- Trace metadata

This keeps workspace safety checks consistent.

## 8. Provider Creation

The composition layer creates the model provider from configuration.

Agent Core should receive a ready `ModelProvider`.

Agent Core should not know:

- Where config files live
- Which environment variable contained the API key
- Which vendor SDK is installed
- How provider-specific clients are constructed

## 9. Tools and Permissions

Tools and permissions are composed separately.

Tools describe possible actions. Permissions decide whether a requested action may run.

The runtime should wire both into Agent Core:

```text
AgentRuntime
  uses ToolRegistry
  uses PermissionPolicy
  emits ApprovalRequest when needed
```

The CLI adapter handles user approval UX, then sends the decision back to the runtime.

## 10. Context Assembly

The context assembler should be created with safe dependencies:

- Effective non-secret config metadata
- Skill index
- Tool definitions
- Session resume source
- Workspace file loader when enabled
- Redaction utilities

CLI should only display context reports produced by the context package.

## 11. Sessions and Trace

The runtime should persist structured records through session and trace interfaces.

Phase 1 may use in-memory or lightweight local storage. The shape should still support:

- Session ID
- Run ID
- User turn ID
- Trace event IDs
- Ordered writes
- Future replay

## 12. Error Handling

Startup errors should be caught at the adapter boundary and rendered clearly.

Examples:

- Invalid config
- Missing API key
- Unsupported provider
- Workspace path does not exist
- Session store cannot initialize

Errors inside an agent run should be emitted into trace when possible.

## 13. Future Adapters

The same composition concept should support:

- Web UI server
- Desktop app
- Messaging adapter
- Background runner

Adapters may differ in how they render events, collect approvals, and handle cancellation. They should not redefine Agent Core behavior.

## 14. Testing Requirements

Runtime composition needs integration tests.

Required test areas:

- Config loader is called before provider creation.
- Agent Core receives configured dependencies.
- CLI does not assemble prompts directly.
- CLI does not instantiate provider SDKs directly when a shared factory exists.
- Missing secret produces adapter-friendly startup error.
- Invalid workspace path stops startup safely.
- Fake model, fake tools, fake permissions, and fake sessions can compose into a working runtime.

## 15. Acceptance Criteria

Runtime composition is successful when:

- A CLI startup path can create all MVP dependencies.
- Agent Core does not read config files or environment variables.
- Prompt assembly remains inside `packages/context`.
- Tool execution still passes through permissions.
- Session and trace persistence are accessed through interfaces.
- Future adapters can reuse the same composition pattern.

## 16. Related Documents

- [Project Structure](./project-structure.md)
- [Configuration System](./configuration-system.md)
- [Architecture Contracts](./contracts.md)
- [CLI Adapter](./cli-adapter.md)
- [Agent Loop](./agent-loop.md)
- [Testing Strategy](./testing-strategy.md)

# Adapters Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@arvinclaw/adapters` is a **capability declaration package** — it contains no runtime logic, only type definitions, constants, and a pure filtering function. Its purpose is to formalize what each surface adapter (CLI, Web, background tasks) can and cannot do, and to define which tools are appropriate for each use case.

```
apps/cli        apps/web        background runner
    │                │                  │
    └────────────────┴──────────────────┘
                     │  imports
                     ▼
             @arvinclaw/adapters
          (capabilities + tool profiles)
```

By centralizing these declarations in one package, the runtime and gateway can make routing decisions (e.g. "does this session support approval prompts?") without importing adapter-specific code.

## Core Concepts

### AdapterCapabilities

Three boolean flags describe an adapter's interaction model:

```typescript
interface AdapterCapabilities {
  streaming: boolean;      // can display token_delta events live
  approvalPrompts: boolean; // can show interactive approval UI
  background: boolean;     // can run without a live user connection
}
```

The canonical constants:

| Constant | `streaming` | `approvalPrompts` | `background` |
|---|---|---|---|
| `CLI_CAPABILITIES` | `true` | `true` | `false` |
| `WEB_CAPABILITIES` | `true` | `true` | `false` |
| `BACKGROUND_CAPABILITIES` | `false` | `false` | `true` |

An architectural invariant enforced by tests: **background adapters cannot have `approvalPrompts: true`**. This prevents accidental registration of a background runner that would hang waiting for human approval with no user present.

### ToolProfile

A `ToolProfile` restricts the set of tools available for a session or task type. Each profile has a named `allowedTools` list. If `allowedTools` is empty (the `"full"` profile), no restriction is applied.

| Profile | Intended use | Key tools allowed |
|---|---|---|
| `"full"` | All tools (no restriction) | _(everything)_ |
| `"coding"` | File system + shell coding tasks | `read_file`, `list_directory`, `write_file`, `run_shell`, `load_skill`, `update_todos`, `spawn_subagent` |
| `"messaging"` | Read-only informational tasks | `read_file`, `list_directory`, `read_web_page`, `memory_search`, `memory_get`, `load_skill`, `update_todos` |
| `"background"` | Unattended background tasks | `read_file`, `list_directory`, `write_file`, `memory_search`, `memory_get`, `append_daily_memory`, `update_todos`, `spawn_subagent` |

The `"background"` profile intentionally excludes `run_shell` and `read_web_page` because unattended execution of shell commands or external web fetches carries higher risk without a user present to review them.

### filterToolsByProfile

```typescript
function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[]
```

A generic pure function that filters any array of named tools against a profile's `allowedTools` list. The `"full"` profile returns the input unchanged (no filtering). The function is generic so callers preserve their concrete `ExecutableTool` type without casting.

### AdapterStorageType

```typescript
type AdapterStorageType = "in-memory" | "jsonl" | "sqlite";
```

Describes the storage backend an adapter uses for sessions. Adapters do not choose storage at runtime — the entrypoint configures and injects a `SessionStore`. This type is used in configuration and documentation to communicate the expected storage strategy.

## Implementation Principles

### Why This Package Exists

Without a shared capability interface, each adapter would need to define its own ad-hoc flags, and the gateway would need to import adapter-specific code to answer "can session X handle approval prompts?". By centralizing in `@arvinclaw/adapters`, the gateway can check `session.capabilities.approvalPrompts` without depending on any adapter implementation.

### Why Tool Profiles Are Here

Tool profiles are a concern of the adapter layer (which surface is being used) rather than the tool layer (which capabilities exist) or the permission layer (which calls are allowed). The CLI might use `"coding"`, a scheduled background task uses `"background"`, and a read-only web widget uses `"messaging"`. The profile selection belongs to the adapter/entrypoint, not to individual tools or the permission system.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the adapters package, public exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the adapters package (no workspace package dependencies). |
| `src/index.ts` | Capability interface and tool profiles | All exports: `AdapterCapabilities`, `AdapterStorageType`, `CLI_CAPABILITIES`, `WEB_CAPABILITIES`, `BACKGROUND_CAPABILITIES`, `ToolProfile`, `ToolProfileDefinition`, `TOOL_PROFILES`, `filterToolsByProfile`. |
| `src/index.test.ts` | Capability and profile tests | Protects capability constant values, the background-cannot-have-approvalPrompts invariant, tool profile definitions, and `filterToolsByProfile` behavior. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

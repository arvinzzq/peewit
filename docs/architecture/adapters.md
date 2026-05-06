# Adapters

Status: Draft
Date: 2026-05-05

Simplified Chinese version: [adapters.zh-CN.md](./adapters.zh-CN.md)

## 1. Purpose

An adapter connects a user-facing surface to Agent Core without owning agent behavior.

Peewit exposes one `AgentRuntime` and multiple surfaces: terminal (CLI), browser (Web UI), and eventually desktop, messaging, and background tasks. The adapter layer keeps those surfaces interchangeable without duplicating agent logic.

## 2. Adapter Boundary Rule

Agent Core owns behavior. Adapters own interaction.

A correct adapter:

- Collects user input (readline, HTTP POST, WebSocket)
- Renders agent output (stdout, SSE, WebSocket push)
- Presents approval prompts (readline confirm, modal overlay)
- Forwards approval decisions via `ApprovalResolver`
- Manages the surface lifecycle (process, HTTP connection, window)

A correct adapter does not:

- Assemble prompts or context
- Define or execute tools
- Apply permission policy
- Determine session or trace persistence strategy (it receives a configured store)
- Configure model providers directly (it receives a configured provider)

## 3. AdapterCapabilities

Each adapter declares what interaction modes it supports.

```ts
export interface AdapterCapabilities {
  streaming: boolean;       // can display token_delta events
  approvalPrompts: boolean; // can show interactive approval UI
  background: boolean;      // can run without a live user connection
}
```

Canonical constants:

| Constant | streaming | approvalPrompts | background |
| --- | --- | --- | --- |
| `CLI_CAPABILITIES` | true | true | false |
| `WEB_CAPABILITIES` | true | true | false |
| `BACKGROUND_CAPABILITIES` | false | false | true |

These declarations serve two purposes:

1. **Documentation**: they make the capability contract explicit rather than implicit.
2. **Runtime routing** (Phase 8+): a gateway can route tasks to adapters that support the required capabilities.

## 4. AdapterStorageType

```ts
export type AdapterStorageType = "in-memory" | "jsonl" | "sqlite";
```

Adapters do not choose their storage strategy at runtime — the server or CLI entrypoint configures storage and passes a `SessionStore` to the adapter. This type is used in configuration and documentation.

## 5. CLI Adapter

Location: `apps/cli`

The CLI adapter uses readline (or Ink for live streaming) to collect input and write output. It uses `JsonlSessionStore` at `~/.peewit/sessions` for durable session history. It supports streaming output and interactive approval prompts.

Capabilities: `CLI_CAPABILITIES`

## 6. Web Adapter

Location: `apps/web`

The Web adapter exposes Agent Core over HTTP and SSE. It uses a shared `JsonlSessionStore` so sessions persist across server restarts and are visible to the CLI. It supports streaming via SSE and approval prompts via a modal overlay.

Capabilities: `WEB_CAPABILITIES`

## 7. Future Adapters

Phase 8 will introduce a background adapter that runs without a live user connection. Background tasks cannot display streaming output or approval prompts — they use `BACKGROUND_CAPABILITIES`.

Phase 10 will introduce a gateway layer that routes tasks to adapters based on their capabilities and the task requirements. The gateway is the point where multiple adapters converge into a single agent network.

## 8. Shared Session Directory

Both CLI and Web use `resolveSessionsDirectory(config, env)` from `packages/config` to compute the sessions directory path. This ensures they point to the same directory and sessions created in one surface are visible in the other.

## 9. What This Is Not

This is not a plugin system. Adapters are first-party surfaces maintained in the same repository. Third-party adapters are a Phase 9+ concern.

This is not a transport protocol. Adapters are not remote nodes. The gateway (Phase 10) handles multi-node communication.

# Gateway Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@arvinclaw/gateway` owns the **session gateway registry**: an in-process registry that tracks which sessions are active, which adapter is hosting each session, and what capabilities that adapter has. It enables multi-adapter coordination without coupling adapters to each other.

```
apps/cli ──register──▶
apps/web ──register──▶  SessionGateway  ◀── future: multi-agent coordinator
scheduler ───────────▶
```

The gateway holds no agent logic, stores no messages, and makes no policy decisions. It is a pure registry: record which sessions exist and which adapter owns them.

## Core Concepts

### GatewaySession

```typescript
interface GatewaySession {
  id: string;
  adapterName: string;           // "cli", "web", "background", etc.
  capabilities: AdapterCapabilities;  // from @arvinclaw/adapters
  registeredAt: string;
  lastActivityAt: string;        // updated by touch()
}
```

### SessionGateway

Five operations:

| Method | Description |
|---|---|
| `register(session)` | Records a new active session |
| `unregister(sessionId)` | Removes a session when it ends |
| `touch(sessionId)` | Updates `lastActivityAt` to now (no-op if unknown) |
| `get(sessionId)` | Returns the session record or `undefined` |
| `list()` | Returns all active sessions |
| `listByAdapter(adapterName)` | Returns sessions for a specific adapter |

The gateway is backed by a `Map<string, GatewaySession>` and is entirely in-memory. There is no persistence — sessions are re-registered each time an adapter starts.

## Implementation Principles

### Why a Separate Package

Without the gateway, a multi-adapter system would require adapters to import each other's code to answer questions like "is there another CLI session already open for this workspace?" or "which sessions support approval prompts?" The gateway decouples this: adapters register with the gateway on startup and query it without needing to know about each other.

### Why Not Persist

The gateway tracks _live_ sessions — sessions that are currently connected. When a process restarts, all sessions end and adapters re-register. Historical session data belongs in `@arvinclaw/sessions`, not the gateway. The gateway's single source of truth is the current process state.

### touch() vs. Direct Update

`touch()` exists as a distinct method (rather than requiring callers to update `lastActivityAt` manually) so that adapters can signal activity without re-registering the entire session record. It also makes the activity timestamp authoritative — only the gateway sets it, preventing clock skew between adapters.

### Capability-Aware Routing (Future)

The `capabilities` field on each `GatewaySession` enables future routing decisions:
- A multi-agent coordinator can check `session.capabilities.approvalPrompts` before routing an approval request to a particular session.
- A background orchestrator can filter `listByAdapter("background")` to find all unattended sessions.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the gateway package with dependency on `@arvinclaw/adapters`. |
| `tsconfig.json` | TypeScript config | Builds the gateway package with a project reference to adapters. |
| `src/index.ts` | Session gateway | All exports: `GatewaySession`, `SessionGateway`, `gatewayPackageName`. |
| `src/index.test.ts` | Gateway tests | Protects register, unregister, touch, get, list, and listByAdapter behavior including edge cases. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

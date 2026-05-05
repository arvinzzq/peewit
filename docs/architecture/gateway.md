# Gateway

Status: Draft (Planned — Phase 10)
Date: 2026-05-05

Simplified Chinese version: [gateway.zh-CN.md](./gateway.zh-CN.md)

## 1. Purpose

The gateway is the routing and coordination layer that sits between adapters and agent runtimes in a multi-surface, multi-agent system.

This document describes the gateway's intended role so that Phase 7–9 decisions do not accidentally foreclose the Phase 10 design.

## 2. Why a Gateway

A single `AgentRuntime` works well when there is one session per process. As ArvinClaw grows toward a personal agent platform, several problems emerge:

- Multiple adapters (CLI, Web, desktop, background) need to reach the same agent sessions.
- Multiple agent runtimes may operate concurrently — one per workspace, one per context, background tasks.
- Some capabilities are adapter-specific: a background task cannot show an approval modal.
- Routing must handle capability mismatches: a tool that requires approval must reach an adapter that can prompt.

The gateway solves these problems by introducing a routing layer above individual adapters.

## 3. Gateway Responsibilities (Phase 10)

- **Session registry**: maps session IDs to active runtimes and their adapter connections.
- **Adapter capability routing**: routes approval requests, streaming output, and background tasks to adapters that support the required capabilities.
- **Multi-agent coordination**: allows one runtime to hand off a subtask to another runtime (sub-agent spawning).
- **Event bus**: broadcasts runtime events to all connected adapters for a session.
- **Lifecycle management**: manages runtime creation, suspension, and cleanup.

## 4. What the Gateway Is Not

The gateway is not a load balancer or cloud service. It is a local coordination layer for a personal agent. It may eventually support remote nodes (Phase 10), but initially it is in-process or on-device.

The gateway does not own agent behavior. Tools, permissions, context assembly, and model providers remain in their respective packages. The gateway routes events; it does not transform them.

## 5. Early Gateway Direction (Phase 7)

Phase 7 establishes the foundation for the gateway:

- `AdapterCapabilities` makes each adapter's abilities explicit, so the gateway can later use them for routing.
- Shared `resolveSessionsDirectory` means CLI and Web write to the same session files, making a shared session registry feasible.
- The Web server's shared `JsonlSessionStore` demonstrates that multiple surfaces can share persistent state.

Phase 8 will introduce background adapters, which require capability-aware routing (no approval prompts, no streaming display).

Phase 10 will build the full gateway on top of these foundations.

## 6. Design Constraints

Any change in Phase 7–9 that would complicate the gateway should be avoided:

- Do not hard-code adapter-specific behavior in `AgentRuntime`.
- Do not couple session storage to a specific adapter.
- Do not allow adapters to bypass `ApprovalResolver` — approval routing is a gateway concern.
- Do not invent a second session directory — both adapters must use the same path so the gateway can unify session access.

## 7. Phase 10 Implementation

Phase 10 delivers the first concrete gateway implementation as the `packages/gateway` package.

The `SessionGateway` class is a simple in-memory registry:

- **`register(session: GatewaySession)`** — called by an adapter when a session becomes active.
- **`unregister(sessionId: string)`** — called when the session ends.
- **`touch(sessionId: string)`** — updates `lastActivityAt` on each active turn.
- **`get(sessionId: string)`** — returns a session record if it exists.
- **`list()`** — returns all active sessions.
- **`listByAdapter(adapterName: string)`** — returns sessions for one adapter surface.

The `GatewaySession` record carries: `id`, `adapterName`, `capabilities` (from `@arvinclaw/adapters`), `registeredAt`, and `lastActivityAt`.

The CLI adapter registers sessions in `CliChatSession.createConfigured()` and unregisters them in `close()`. The Web adapter registers sessions in `createWebSession()`. The Web server exposes `GET /api/gateway/sessions` so callers can inspect the registry.

## 8. References

- [Adapters](./adapters.md) — adapter boundary, capabilities, and current surfaces
- [Session Storage](./session-storage.md) — session persistence contracts
- [OpenClaw Architecture Map](./openclaw-architecture-map.md) — OpenClaw's gateway and node protocol
- [Multi-Agent Runtime](./multi-agent-runtime.md) — sub-agent spawning that the gateway will coordinate

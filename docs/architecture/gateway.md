# Gateway

Status: Active (Phase 10 foundation, Phase 11 expansion planned)
Date: 2026-05-11

Simplified Chinese version: [gateway.zh-CN.md](./gateway.zh-CN.md)

## 1. Purpose

The gateway is the routing and coordination layer that sits between adapters and agent runtimes. From Phase 11 forward, it is also the single accept point for every agent run: CLI, Web, scheduler, sub-agents, and future channels all submit work through it.

This document describes both the Phase 10 foundation (session registry) and the Phase 11 expansion (`GatewayCore` with submit / subscribe / cancel and three-tier lane admission).

## 2. Why a Gateway

A single `AgentRuntime` works well when there is one session per process. As Vole grows toward a personal agent platform, several problems emerge:

- Multiple adapters (CLI, Web, desktop, background) need to reach the same agent sessions.
- Multiple agent runtimes may operate concurrently — one per workspace, one per context, background tasks.
- Some capabilities are adapter-specific: a background task cannot show an approval modal.
- Concurrency must be bounded: unbounded sub-agent spawning or parallel writes corrupt state.
- Cancellation needs a single point of authority that knows which lane to interrupt.

The gateway solves these problems by introducing a routing and admission layer above individual adapters.

## 3. GatewayCore API (Phase 11)

Phase 11 extends `SessionGateway` into a `GatewayCore` that every adapter must submit through:

```ts
interface GatewayCore {
  submit(req: RunRequest): AsyncIterable<RuntimeEvent>;
  subscribe(sessionKey: string): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  status(): GatewayStatus;

  register(session: GatewaySession): void;
  unregister(sessionKey: string): void;
  touch(sessionKey: string): void;
  get(sessionKey: string): GatewaySession | undefined;
  list(filter?: GatewayListFilter): GatewaySession[];
}
```

`submit` resolves the target session, chains the run through the appropriate lanes (see [Lanes](./lanes.md)), and yields runtime events. `subscribe` taps into an already-running session's event stream without itself triggering a run — useful for Web UIs that join late. `cancel` interrupts a specific run by id; the session lane releases its slot and pending queued work continues.

`register / unregister / touch / get / list` keep the Phase 10 session-registry surface. The session record carries `sessionKey`, `agentId`, `adapterName`, `capabilities`, `registeredAt`, and `lastActivityAt`.

## 4. What the Gateway Is Not

The gateway is not a load balancer or cloud service. It is an in-process coordination layer for one local Vole instance. It may eventually own a remote transport (Phase 17+), but Phase 11 keeps the gateway entirely in-process.

The gateway does not own agent behavior. Tools, permissions, context assembly, and model providers remain in their respective packages. The gateway routes submissions, applies lane admission, and dispatches events; it does not transform model output or override permission decisions.

The gateway does not own session storage either. JSONL and (Phase 14) SQLite stores live in `packages/sessions`. The gateway holds session *metadata* in memory and looks transcripts up through the store when needed.

## 5. Phase 10 Foundation

Phase 10 delivered the first concrete `packages/gateway` package with `SessionGateway` as an in-memory session registry:

- `register(session)` is called by an adapter when a session becomes active.
- `unregister(sessionKey)` is called when the session ends.
- `touch(sessionKey)` updates `lastActivityAt` on each active turn.
- `get / list / listByAdapter` expose the registry to callers.

The CLI adapter registers sessions in `CliChatSession.createConfigured()` and unregisters them in `close()`. The Web adapter registers sessions in `createWebSession()`. The Web server exposes `GET /api/gateway/sessions` so callers can inspect the registry.

Phase 11 keeps these methods and adds the submit / subscribe / cancel surface on top.

## 6. Phase 11 Expansion

Phase 11 makes the gateway the only legitimate caller of `AgentRuntime.runTurn`:

- Adapters stop constructing `AgentRuntime` and instead call `gateway.submit(req)`.
- Each submit threads through the three default lanes — global, subagent (when applicable), and session — before the runtime executes.
- Session keys are normalized to `agent:<agentId>:<lane-type>:<uuid>`, encoding agent identity and parent / child relationships in the key itself.
- The cross-process file lock around session JSONL is acquired and released inside the session lane closure; cross-process callers serialize through both layers.
- `cancel(runId)` propagates an abort signal into the active `runTurn`; the runtime must honor it at safe checkpoints (before the next model call, before the next tool call).
- `status()` returns a snapshot of lane occupancy and active runs for the `vole gateway status` command.

`AgentRuntime` itself stays focused on the turn loop and remains independently testable. The runtime accepts an optional abort signal and a session-mutex-shaped lock; Phase 11 wires those to the session lane and file lock.

## 7. Future Direction

Phase 12 layers per-parent child counters on top of the subagent lane for `maxChildrenPerAgent` enforcement. Phase 15 channels submit through the same gateway with a `channel:` prefix in the session key. Phase 16 doctor checks inspect gateway state for stale sessions and orphan locks.

Remote transports are explicitly out of scope through Phase 16. If a future phase exposes the gateway over HTTP / Unix socket, the API shape above is designed to translate one-to-one onto an RPC: each method becomes an RPC method, `AsyncIterable<RuntimeEvent>` becomes a server-streaming response.

## 8. References

- [Lanes](./lanes.md) — admission and serialization primitive
- [Run Queue](./run-queue.md) — run lifecycle and state machine
- [Adapters](./adapters.md) — adapter boundary and capabilities
- [Session Storage](./session-storage.md) — session persistence contracts
- [Multi-Agent Runtime](./multi-agent-runtime.md) — sub-agent spawning that the gateway coordinates
- [OpenClaw Architecture Map](./openclaw-architecture-map.md) — OpenClaw's gateway and node protocol
- [Phase 11 Plan](../plans/phase-11-gateway-and-lanes.md)

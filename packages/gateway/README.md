# Gateway Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/gateway` is the **single accept point for every agent run**. It owns two layers:

1. `SessionGateway` — the original in-process session registry from Phase 10: which sessions are active, which adapter hosts each one, and what capabilities that adapter has.
2. `GatewayCore` — the Phase 11 expansion that adds run admission, cancellation, and status reporting on top of the registry. Every accepted run is threaded through the global / sub-agent / per-session lane chain from `@vole/lanes` before the caller's run function executes.

```
apps/cli ──submit──▶
apps/web ──submit──▶  GatewayCore  ──runThroughLanes──▶  AgentRuntime.runTurn
scheduler ─────────▶       │
                           ├── SessionGateway registry (register, list, ...)
                           ├── LaneRegistry (global / subagent / session)
                           └── activeRuns map (for cancel + status)
```

The gateway holds no agent logic, stores no messages, and makes no policy decisions. It is pure orchestration: which sessions exist, which lanes admit a run, which runs are currently active.

## Core Concepts

### GatewaySession

```typescript
interface GatewaySession {
  id: string;
  adapterName: string;           // "cli", "web", "background", etc.
  capabilities: AdapterCapabilities;  // from @vole/adapters
  registeredAt: string;
  lastActivityAt: string;        // updated by touch()
}
```

### SessionGateway

The Phase 10 registry, preserved as a separate base class:

| Method | Description |
|---|---|
| `register(session)` | Records a new active session |
| `unregister(sessionId)` | Removes a session when it ends |
| `touch(sessionId)` | Updates `lastActivityAt` to now (no-op if unknown) |
| `get(sessionId)` | Returns the session record or `undefined` |
| `list()` | Returns all active sessions |
| `listByAdapter(adapterName)` | Returns sessions for a specific adapter |

In-memory only; sessions are re-registered each time an adapter starts.

### GatewayCore

Extends `SessionGateway` with Phase 11 admission semantics:

```typescript
interface RunRequest<TEvent = unknown> {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent?: boolean;
  run: (signal: AbortSignal) => AsyncIterable<TEvent>;
}

class GatewayCore extends SessionGateway {
  submit<TEvent>(req: RunRequest<TEvent>): AsyncIterable<TEvent>;
  cancel(runId: string): boolean;
  status(): GatewayStatus;
}
```

`submit` accepts a caller-provided `run` function, threads it through the lane chain, and yields events as they are produced. `cancel` aborts the run by calling `controller.abort()`; the run function is expected to honour the signal at safe checkpoints. `status()` returns a snapshot of lane occupancy plus the active run handles for the `vole gateway status` command.

### Type Genericity

`GatewayCore` is event-type-agnostic. `RunRequest<TEvent>` is generic so the caller can specialise the event type without the gateway depending on `@vole/core`. The CLI / Web adapters parameterise it with `RuntimeEvent`; tests use `string` for simplicity.

## Implementation Principles

### Why the Gateway Owns Admission

A single `AgentRuntime` worked when there was one session per process. As Vole grows, four problems emerged that only a centralised gateway can solve:

- Multiple adapters need to reach the same agent sessions without coupling.
- Concurrency must be bounded: unbounded sub-agent spawning corrupts state.
- Cancellation needs a single point of authority that knows which lane to interrupt.
- Status (`vole gateway status`) needs one place to read live occupancy.

The gateway is the only legitimate caller of `AgentRuntime.runTurn` from Phase 11 onward.

### No Direct Dependency on @vole/core

The gateway does not import `@vole/core`. Instead, the caller wraps `AgentRuntime` construction and invocation in a `run(signal) => AsyncIterable<events>` callback. This inversion keeps the dependency graph acyclic: gateway → lanes, gateway → adapters, but not gateway → core.

### Cancellation Semantics

`cancel(runId)` returns `true` if a matching run exists and was signalled. It does not wait for the run to actually stop — the caller decides what counts as a safe stop point. If a queued run is cancelled before its lane slot opens, the run function still starts but observes `signal.aborted === true` immediately and is expected to return without doing work.

### AsyncEventQueue (Internal)

The internal `AsyncEventQueue` bridges the lane-chained run (which is promise-based) and the caller (which is iteration-based). Producer pushes events, consumer iterates; closing the queue ends iteration cleanly, failing it throws on the next iteration. This is not exported.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the gateway package with dependencies on `@vole/adapters` and `@vole/lanes`. |
| `tsconfig.json` | TypeScript config | Builds the gateway package with project references to adapters and lanes. |
| `src/index.ts` | Gateway primitives | All exports: `GatewaySession`, `SessionGateway`, `GatewayCore`, `RunRequest`, `RunHandle`, `GatewayStatus`, `GatewayCoreOptions`, `gatewayPackageName`. |
| `src/index.test.ts` | Gateway tests | Covers `SessionGateway` registry semantics plus `GatewayCore` event streaming, lane admission ordering, cancellation, status snapshots, error propagation, and sub-agent lane caps. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

# Lanes

Status: Planned (Phase 11)
Date: 2026-05-11

Simplified Chinese version: [lanes.zh-CN.md](./lanes.zh-CN.md)

## 1. Purpose

Lanes are Vole's run-admission and serialization primitive. A lane is a FIFO queue with a configurable concurrency limit; every run a gateway accepts must pass through one or more lanes before it executes.

This document specifies the lane model introduced in Phase 11 and how the gateway, sessions, and sub-agents compose with it. It replaces ad hoc serialization via `SessionMutex` and prepares the runtime for sub-agent concurrency policy, channel routing, and cross-process safety.

## 2. Lane Concept

A `Lane` is the simplest possible scheduler:

```ts
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}
```

Behavior:

- Submitted work is dequeued in submission order.
- At most `maxConcurrent` items run at a time; later submissions wait.
- When an active slot frees, the next queued item starts.
- The returned promise resolves with the work result or rejects with the thrown error.

A lane has no opinion about what runs inside it. The gateway decides which lanes apply to a run and chains them with `Promise`-based composition.

## 3. Three Default Lane Tiers

Phase 11 ships three lane tiers; every accepted run is gated by every applicable tier:

| Lane key | Default concurrency | Scope | Purpose |
| --- | --- | --- | --- |
| `global` | 16 | Every run | Backstop against unbounded parallelism |
| `subagent` | 8 | Sub-agent-initiated runs only | Caps total parallel children across all parents |
| `session:<sessionId>` | 1 | One session | Strict serialization of per-session writes |

A user-initiated CLI run passes through `global` and the relevant `session:<id>`. A `spawn_subagent_async` run passes through `global`, `subagent`, and its child `session:<id>`.

Per-session concurrency of 1 reproduces the previous `SessionMutex` semantics exactly. The session lane is therefore a strict generalization of the mutex.

## 4. Admission Control

Admission is composition, not branching. The gateway wraps work in a lane chain:

```text
gateway.submit(req) ≡
  globalLane.enqueue(() =>
    (req.isSubagent ? subagentLane.enqueue(work) : work()))
```

where `work` is itself `sessionLane(req.sessionId).enqueue(() => runtime.runTurn(req))`.

Per-parent caps (the `maxChildrenPerAgent` policy used in Phase 12) are layered above this: the gateway tracks active child counts per parent session and refuses admission when the cap is hit, before the lane chain is entered. The lane system itself is unaware of parent / child semantics.

## 5. Lane Lifecycle

Lanes are created lazily and live as long as `GatewayCore` is alive.

- `global` and `subagent` exist from gateway construction.
- `session:<id>` lanes are created on first access and retained while the session is referenced.
- A lane is reclaimed when its session is unregistered and its queue is empty.

Lane state is in-process. Cross-process serialization for the same session ID is the cross-process file lock's responsibility, not the lane's. The two compose: an in-process lane orders writes within one Node process; the file lock orders writes across processes.

## 6. Composition with GatewayCore

`GatewayCore` is the only caller that constructs lane chains. Adapters submit `RunRequest`s, never lanes:

```ts
gateway.submit({
  sessionKey: "agent:default:main",
  agentId: "default",
  message: "...",
  isSubagent: false
});
```

The gateway resolves the session, selects the lane chain, and runs the work. Submitters cannot bypass the chain; there is no public path that constructs `AgentRuntime` and calls `runTurn` outside the gateway in Phase 11 forward.

## 7. Relationship to Session Lock

Lane behavior and the cross-process file lock both arrive in Phase 11 but solve different problems:

| Concern | Lane | File lock |
| --- | --- | --- |
| Same Node process, same session | ✓ session lane | (redundant) |
| Same Node process, different sessions | ✓ global / subagent lane | not involved |
| Different processes, same session | not involved | ✓ file lock |
| Different processes, different sessions | not involved | not involved |

The session lane releases its slot before the file lock releases its handle; readers always see writes in lane order, then file-system order if cross-process.

## 8. Testing Requirements

Lane tests must cover:

- FIFO order under heavy enqueue load.
- Concurrency cap enforcement under random arrival times.
- Slot release on both success and rejection paths.
- Composition with `GatewayCore.submit`: a session lane's concurrency 1 produces strict ordering of `runTurn` invocations.
- No starvation when sub-agent runs and parent runs share `global`.
- Lane reclaim after session unregister with non-empty queue (queue drains then reclaims).

A `vole gateway status` integration test asserts lane occupancy reflects active and queued runs accurately.

## 9. Acceptance Criteria

The lane model is successful in Phase 11 when:

- `SessionMutex` is removed from `packages/sessions`; all per-session serialization runs through the session lane.
- All three default tiers are configurable via `gateway.lanes.*` config keys.
- 100 parallel submits to one session lane complete in submission order with no JSONL corruption.
- A parent that spawns 12 async sub-agents sees at most 8 running concurrently (subagent lane cap).
- Removing the lane system from the code path makes a deliberate regression test fail.

## 10. References

- [Phase 11 Plan](../plans/phase-11-gateway-and-lanes.md)
- [Gateway](./gateway.md)
- [Run Queue](./run-queue.md)
- [Session Storage](./session-storage.md)
- [Multi-Agent Runtime](./multi-agent-runtime.md)

# Lanes Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/lanes` owns the **run admission and serialization primitive**: a `Lane` is a FIFO queue with a configurable concurrency limit. The gateway uses a `LaneRegistry` to compose three default tiers (global, sub-agent, per-session) into the admission chain every run must pass through before the runtime executes it.

```
gateway.submit(req)
    │
    ▼
runThroughLanes(registry, { sessionId, isSubagent }, work)
    │
    ├─ global lane           (cap 16: backstop)
    │   └─ subagent lane     (cap 8: only for sub-agent runs)
    │       └─ session lane  (cap 1: strict per-session ordering)
    │           └─ work()    (AgentRuntime.runTurn)
```

This package is intentionally tiny and has no dependencies on other workspace packages. It does not know about `AgentRuntime`, sessions storage, or model providers.

## Core Concepts

### Lane

```typescript
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}
```

A lane is a FIFO scheduler. Submitted work is dequeued in submission order; at most `maxConcurrent` items run at a time; later submissions wait until a slot frees. The returned promise resolves with the work result or rejects with the thrown error. Slot release happens in `finally`, so failures do not leak capacity.

### FifoLane

The default `Lane` implementation. Construction validates `maxConcurrent ≥ 1` and integer; a concurrency of 1 reproduces strict serial execution and is the same semantics the old `SessionMutex` provided.

### LaneRegistry

Holds the three tiers used by `GatewayCore`:

| Field | Default `maxConcurrent` | Scope |
| --- | --- | --- |
| `global` | 16 | Every run |
| `subagent` | 8 | Sub-agent-initiated runs only |
| `sessionLane(id)` | 1 | One session, lazy-created |

`releaseSessionLane(id)` returns `true` only when the lane is idle (active = 0, queued = 0). The lane is otherwise retained until it is safe to reclaim. `status()` returns a snapshot of occupancy across all tiers for the `vole gateway status` command.

### runThroughLanes

Composes the three tiers in order:

```typescript
await runThroughLanes(
  registry,
  { sessionId: "agent:default:main", isSubagent: false },
  () => runtime.runTurn(req)
);
```

The chain order is `global → (subagent if applicable) → session → work`. The session lane is the innermost; its slot is released before the subagent and global slots so backpressure flows outward.

## Implementation Principles

### Why a Separate Package

Run admission is a **scheduling concern**, not a runtime concern. Separating it allows:

1. **`AgentRuntime` stays unaware of admission**: it accepts an abort signal and runs; it does not enforce concurrency or session ordering.
2. **`GatewayCore` is the only caller**: the lane chain is constructed in one place; adapters cannot bypass it.
3. **Independently testable**: lane behavior is deterministic and trivially unit-tested without spinning up a runtime.

### Per-Session Concurrency 1

The session tier defaults to `maxConcurrent: 1`. This is the strict generalization of the old in-process `SessionMutex`: same observable behavior, but composable with other tiers.

### Cross-Process Serialization

Lane state is in-process. Two `vole` processes targeting the same session each maintain their own session lane; cross-process write ordering is the cross-process file lock's responsibility (Phase 11 ships that lock in `packages/sessions`). The two layers compose: lane orders writes within one Node process; file lock orders writes across processes.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the lanes package, export entrypoint, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the lanes package (no dependencies on other workspace packages). |
| `src/index.ts` | Lane primitive | All exports: `Lane`, `LaneOccupancy`, `FifoLane`, `LaneRegistry`, `LaneRegistryStatus`, `LaneRegistryOptions`, `DEFAULT_LANE_CONCURRENCY`, `LaneChainOptions`, `runThroughLanes`. |
| `src/index.test.ts` | Lane tests | Covers FIFO order, concurrency caps, slot release on success and failure, registry session-lane reuse and reclaim, lane chain composition, plus Phase 11 §5 acceptance scenarios. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

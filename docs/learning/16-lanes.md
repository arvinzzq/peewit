# Module 15: @vole/lanes

Status: Complete (Phase 11 Step 2)
Date: 2026-05-11

Simplified Chinese version: `16-lanes.zh-CN.md`

Related source: `packages/lanes/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 4 (Extension Systems) in the [learning guide](./guide.md). Read
it after [13-gateway.md](./13-gateway.md) — `LaneRegistry` is the primitive the new `GatewayCore`
(Phase 11 Step 3) will use to admit and serialize runs.

**Before reading**: Read `packages/lanes/src/index.ts` in full (under 150 lines, dependency-free).
Then read `packages/lanes/src/index.test.ts` — the tests are honest usage documentation, especially
the FIFO order test and the "12 subagents under default caps" scenario.

**Focus questions**:

- A `Lane` is just a FIFO queue with a concurrency cap. What does the gateway use it for that
  the old `SessionMutex` could not do?
- `releaseSessionLane` only returns `true` for idle lanes. What would go wrong if it always
  released, regardless of active count?
- `runThroughLanes` chains `global → optional subagent → session`. Why is `session` innermost?

**Checkpoint**: You understand this module when you can sketch the admission chain on paper, show
where slots are acquired and released in each tier, and explain why this generalizes the previous
single-mutex design without changing observable behavior for the CLI single-session case.

## 1. What This Module Does

**Plain language**: Think of an airport with three checkpoints. The first checkpoint controls
how many people are in the building at all. The second checkpoint is just for delegates from a
specific tour group (sub-agents). The third checkpoint is the gate for one specific flight (a
session) — only one person walks through that gate at a time. A passenger must clear all
applicable checkpoints before boarding. `@vole/lanes` is the airport.

**Technical summary**: `@vole/lanes` provides `FifoLane`, a FIFO queue with a configurable
concurrency cap, and `LaneRegistry`, which holds three default lanes (global, sub-agent, and
one per session) that the gateway composes into the admission chain every accepted run must
pass through. The `runThroughLanes` helper applies the chain in order. The package has no
dependencies on other workspace packages.

## 2. Why It Exists

Phase 0–10 used a single `SessionMutex` in `@vole/sessions` to serialize per-session writes.
That worked for the one-user-one-shell case. As Vole grows, three new constraints appear:

- Sub-agent spawning can produce many concurrent runs; without a bound, the model can flood the
  process with parallel children.
- Multiple adapters (CLI, Web, scheduler, future channels) all want to submit work for the same
  workspace; the runtime needs a single point of admission.
- A global parallelism backstop is needed so any single misbehaving spawner cannot exhaust
  resources.

Without lanes, every adapter would re-invent admission and per-session ordering, each in slightly
different ways. The lane primitive collapses these to a uniform, testable scheduler.

## 3. Public Interface

```ts
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}

class FifoLane implements Lane {
  constructor(options: { key: string; maxConcurrent: number });
}

class LaneRegistry {
  constructor(options?: {
    globalConcurrency?: number;    // default 16
    subagentConcurrency?: number;  // default 8
    sessionConcurrency?: number;   // default 1
  });
  readonly global: Lane;
  readonly subagent: Lane;
  sessionLane(sessionId: string): Lane;
  releaseSessionLane(sessionId: string): boolean;
  status(): LaneRegistryStatus;
}

function runThroughLanes<T>(
  registry: LaneRegistry,
  options: { sessionId: string; isSubagent?: boolean },
  work: () => Promise<T>
): Promise<T>;

const DEFAULT_LANE_CONCURRENCY: { global: 16; subagent: 8; session: 1 };
```

Every export is in `packages/lanes/src/index.ts`. No re-exports, no submodules.

## 4. Implementation Walkthrough

### FifoLane: enqueue and slot release

```ts
async enqueue<T>(work: () => Promise<T>): Promise<T> {
  if (this.#active >= this.maxConcurrent) {
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
  }
  this.#active++;
  try {
    return await work();
  } finally {
    this.#active--;
    const next = this.#waiters.shift();
    if (next !== undefined) next();
  }
}
```

The slot is released in `finally`, so a rejected work function does not leak capacity. Waiters
are stored as `() => void` resume callbacks and dequeued FIFO. There is no priority, no
preemption, no cancellation at this layer — keep the primitive small.

Validation in the constructor rejects non-integer or non-positive `maxConcurrent`. A common bug
in early-design schedulers is silently accepting `0` and then deadlocking; the assertion makes
the failure mode loud.

### LaneRegistry: lazy session lanes and idle reclaim

```ts
sessionLane(sessionId: string): Lane {
  let lane = this.#sessionLanes.get(sessionId);
  if (lane === undefined) {
    lane = new FifoLane({
      key: `session:${sessionId}`,
      maxConcurrent: this.#sessionConcurrency
    });
    this.#sessionLanes.set(sessionId, lane);
  }
  return lane;
}

releaseSessionLane(sessionId: string): boolean {
  const lane = this.#sessionLanes.get(sessionId);
  if (lane === undefined) return false;
  const { active, queued } = lane.occupancy();
  if (active === 0 && queued === 0) {
    this.#sessionLanes.delete(sessionId);
    return true;
  }
  return false;
}
```

Lazy creation means the registry has zero session lanes at startup. Idle-only reclaim is the
crucial invariant: removing a lane that still has queued waiters would orphan them. The boolean
return lets callers (gateway cleanup, doctor command) distinguish "removed" from "still in use."

### runThroughLanes: chain composition

```ts
const sessionLane = registry.sessionLane(options.sessionId);
const runInner = () => sessionLane.enqueue(work);
const runWithSubagent = () =>
  options.isSubagent === true ? registry.subagent.enqueue(runInner) : runInner();
return registry.global.enqueue(runWithSubagent);
```

Read it bottom-up. `work` is wrapped in a session-lane enqueue (innermost). If this is a
sub-agent run, the session-lane enqueue is wrapped in a sub-agent-lane enqueue. The whole thing
is wrapped in a global-lane enqueue (outermost). Each lane controls its own waiters; backpressure
propagates outward when an inner lane saturates.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| `pi-embedded-runner/lanes.ts` (session lane + global lane) | `LaneRegistry` | Same per-session + global structure |
| Per-session strict serialization | `sessionLane(id)` with `maxConcurrent: 1` | Identical semantics; replaces `SessionMutex` |
| Subagent lane (`subagents.maxConcurrent`) | `LaneRegistry.subagent` | Same default of 8 |
| Lane occupancy reporting | `Lane.occupancy()` + `LaneRegistry.status()` | Same shape, used by future `vole gateway status` |
| Per-parent `maxChildrenPerAgent` | Layered above lanes (Phase 12) | Lanes are unaware of parent identity |

The biggest divergence: OpenClaw's lanes are tied to the embedded runner internals. Vole exposes
them as a tiny independent package because the gateway, scheduler, and future channels all want
admission control.

## 6. Key Design Decisions

**Three tiers, not four or two.** Two tiers (global + session) would not bound sub-agent
parallelism distinct from other work. Four tiers would invite ad-hoc additions for every future
caller (channels, scheduled tasks, etc.) and lead to a combinatorial mess. Three matches OpenClaw
and covers the real distinctions: total work, sub-agent work, per-session work.

**Lanes do not know about parent / child relationships.** `maxChildrenPerAgent` (Phase 12) lives
in the gateway, not the lanes. The lane primitive is intentionally identity-agnostic; adding
parent counters here would couple admission to the multi-agent model and prevent future reuse.

**Slot release in `finally`, not after `await`.** A naive implementation might do
`work(); this.#active--;` outside of a `finally`. That fails when `work()` rejects. Putting the
release in `finally` is the only correct way to ensure capacity is always returned, no matter
what the work does.

**`runThroughLanes` as a helper, not a method.** Putting chain composition on `LaneRegistry`
would tempt callers to mix chain construction with lane access. Keeping it as a free function
forces the gateway to be explicit about what it is composing and makes the chain easy to test
without the registry.

## 7. Testing Approach

Tests are in `packages/lanes/src/index.test.ts`. Sixteen tests covering:

- `FifoLane` construction validation (rejects 0, negative, fractional).
- Strict FIFO under 100 parallel submits on a `maxConcurrent: 1` lane.
- Concurrency cap enforcement with random arrival times.
- Slot release on both success and rejection paths.
- Subsequent waiters run in submission order after a failure.
- `LaneRegistry` default concurrencies, session-lane lazy creation and reuse, idle-only reclaim,
  status snapshot.
- `runThroughLanes` chaining order, sub-agent vs. non-sub-agent dispatch, no cross-tier
  starvation.
- Phase 11 acceptance: 100 parallel session-lane submits complete in order; 12 sub-agent
  submits run at most 8 concurrently under defaults.

All tests are synchronous-style async/await; no fakes are needed because the module has no
dependencies. `deferred<T>()` helpers gate work execution to make timing assertions deterministic.

## 8. Insights

**Lanes are not the same as a mutex.** A mutex guarantees mutual exclusion; a lane with
`maxConcurrent: 1` happens to do that, but the abstraction is FIFO scheduling with a cap.
Conflating the two leads to mistakes when callers want concurrency 2 or 8.

**The session lane is the strict generalization of `SessionMutex`.** When `maxConcurrent: 1`,
observable behavior is identical: one writer at a time, others wait in submission order. The
generalization buys composition with other tiers — something a mutex cannot do.

**Reclaim is conservative on purpose.** A lane that "looks" idle for a microsecond might be
re-acquired by a pending work submission the next tick. The gateway should call
`releaseSessionLane` only after a session has been explicitly unregistered; otherwise idle
churn would re-create lanes constantly.

**This package is dependency-free for a reason.** Any future caller (a tool, a doctor command,
a benchmark) can import `@vole/lanes` without dragging in the runtime, sessions, or models. The
small surface keeps the seam stable.

## 9. Review Questions

1. Why does `FifoLane.enqueue` use a `Promise<void>` waiter array instead of `Promise<T>`?
   > Different work submissions have different return types. The waiter only signals "your turn
   > now"; the actual work value flows through the returned promise of `enqueue<T>`. Mixing them
   > would force the lane to be generic in a way it does not need to be.

2. What happens if `releaseSessionLane` is called while waiters are queued?
   > It returns `false` and does not remove the lane. Removing it would orphan the waiters and
   > leak the work that triggered them. The lane is reclaimed only when both `active` and
   > `queued` are 0.

3. `runThroughLanes` chains three tiers. Why is the session lane innermost?
   > Per-session writes are the strictest constraint (concurrency 1). Putting the session lane
   > innermost means the slot is released as soon as the session-mutating work finishes,
   > freeing the lane for the next session-bound submission while broader lanes (sub-agent,
   > global) remain occupied for any wrap-up cost the outer composition might add.

4. Two `vole` processes target the same session. Do their lanes coordinate?
   > No. Each process has its own `LaneRegistry` and its own session lane for that session ID.
   > Cross-process serialization is the cross-process file lock's job (Phase 11 Step 4 in
   > `@vole/sessions`). The two layers compose: lane orders writes within one Node process; the
   > file lock orders writes across processes.

5. What changes for the CLI single-session user when `SessionMutex` is replaced by a session
   lane?
   > Nothing observable. A session lane with `maxConcurrent: 1` is the strict generalization of
   > the mutex. The new code path also composes cleanly with the global and sub-agent lanes,
   > so adding sub-agents later does not require revisiting per-session serialization.

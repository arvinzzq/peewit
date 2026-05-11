# Module 12: @vole/gateway

Status: Complete (Phase 11 Step 3 rewrite)
Date: 2026-05-11

Simplified Chinese version: `13-gateway.zh-CN.md`

Related source: `packages/gateway/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 4 (Extension Systems) in the [learning guide](./guide.md). Read it
after [16-lanes.md](./16-lanes.md) — `GatewayCore` composes the `LaneRegistry` defined there into
the admission chain every run must pass through.

**Before reading**: Read `packages/gateway/src/index.ts` end-to-end. It is one file with two
classes (`SessionGateway`, `GatewayCore`), one internal queue helper, and a handful of types.
Then read `packages/gateway/src/index.test.ts` — the lane-ordering test is the clearest example
of why admission matters.

**Focus questions**:

- The gateway never imports `@vole/core`. How does it call `AgentRuntime.runTurn` then?
- `cancel(runId)` returns immediately. When does the run actually stop?
- `submit` is an async generator from the caller's perspective. Why is the lane-chained work
  fire-and-forget instead of `await`ed in the same generator?

**Checkpoint**: You understand this module when you can sketch the full path of one submit — from
the caller's `gateway.submit(req)` call, through lane admission, through the run function, back
out as iterable events — and explain where each early-exit (cancel, error, completion) lives.

## 1. What This Module Does

**Plain language**: The gateway is a front-of-house host plus a queue manager. Every guest (a
run) arrives at the same door (`submit`). The host checks how full the room is (global lane,
sub-agent lane, the guest's reserved table = session lane), seats the guest when capacity allows,
and lets the kitchen (the caller's run function) start cooking. While the food comes out
(events), the host keeps a list of who is currently seated (`activeRuns`) so the manager can ask
people to leave (`cancel`) or print a status report (`status`).

**Technical summary**: `@vole/gateway` ships two cooperating classes. `SessionGateway` is the
in-memory registry of active sessions (register / unregister / touch / list). `GatewayCore`
extends it with `submit`, `cancel`, and `status` — admitting every run through the global,
sub-agent, and session lanes from `@vole/lanes`, tracking active runs by `runId` for
cancellation, and reporting lane occupancy for the `vole gateway status` command. The package
has no dependency on `@vole/core`; callers supply the actual runtime invocation as a `run`
function.

## 2. Why It Exists

Through Phase 10, adapters constructed `AgentRuntime` directly and used `SessionMutex` for
per-session ordering. That works for one user with one shell. As Vole grows it falls apart:

- Multiple adapters (CLI, Web, scheduler, future channels) all want to start runs for the same
  workspace. Without a central admission point, each adapter would re-implement queueing.
- Sub-agent spawning can produce many concurrent runs. Unbounded parallelism corrupts state and
  exhausts resources.
- Cancellation needs a single point of authority. Two adapters cancelling the same run shouldn't
  race.
- A `vole gateway status` command needs one place to read live occupancy.

The gateway centralises all four. From Phase 11 forward, every run goes through it.

## 3. Public Interface

```ts
interface GatewaySession {
  id: string;
  adapterName: string;            // "cli" | "web" | "background" | ...
  capabilities: AdapterCapabilities;
  registeredAt: string;
  lastActivityAt: string;
}

class SessionGateway {
  register(session: GatewaySession): void;
  unregister(sessionId: string): void;
  touch(sessionId: string): void;
  get(sessionId: string): GatewaySession | undefined;
  list(): GatewaySession[];
  listByAdapter(adapterName: string): GatewaySession[];
}

interface RunRequest<TEvent = unknown> {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent?: boolean;
  run: (signal: AbortSignal) => AsyncIterable<TEvent>;
}

interface RunHandle {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent: boolean;
  startedAt: string;
}

interface GatewayStatus {
  lanes: LaneRegistryStatus;
  activeRuns: RunHandle[];
}

class GatewayCore extends SessionGateway {
  constructor(options?: { lanes?: LaneRegistryOptions; now?: () => string });
  submit<TEvent = unknown>(req: RunRequest<TEvent>): AsyncIterable<TEvent>;
  cancel(runId: string): boolean;
  status(): GatewayStatus;
}
```

The `SessionGateway` API is unchanged from Phase 10 — keeping the Phase 10 baseline tests green.
Everything else is new in Phase 11 Step 3.

## 4. Implementation Walkthrough

### submit: lane chain + async queue

The conceptual flow of `submit`:

1. Allocate an `AbortController` for this run.
2. Register the run in `#activeRuns` so `cancel` and `status` can find it.
3. Construct an `AsyncEventQueue<TEvent>` to bridge producer (the run function) to consumer
   (the caller iterating the returned iterable).
4. Fire `runThroughLanes(this.#lanes, { sessionId, isSubagent }, work)`. Note: not awaited.
   This is fire-and-forget: the lane chain executes asynchronously while we return the queue
   immediately.
5. When `runThroughLanes` resolves (work finished, or admission failed before starting), close
   or fail the queue and remove the run from `#activeRuns`.
6. Return the queue as the async iterable to the caller.

The fire-and-forget shape is the only way to admit the run eagerly while letting the caller
iterate lazily. If we awaited `runThroughLanes` inside an async generator, the caller would have
to consume events to make the admission progress — backwards.

### The work function inside the lane chain

```ts
async () => {
  if (controller.signal.aborted) return;
  for await (const event of req.run(controller.signal)) {
    if (controller.signal.aborted) break;
    queue.push(event);
  }
}
```

Two abort checks: one before invoking `req.run` (handles cancel-before-admission cleanly: the
run never starts), and one inside the iteration (handles cancel-during-run by stopping event
push immediately). The caller's run function is also given the same signal and is expected to
honour it at safer checkpoints (between model calls, between tool calls).

### Active-run cleanup ordering

```ts
.then(() => {
  activeRuns.delete(req.runId);
  queue.close();
})
.catch((err: unknown) => {
  activeRuns.delete(req.runId);
  queue.fail(err);
});
```

Deletion is synchronous *before* close/fail. That guarantees: by the time a consumer's iterator
sees `done: true` (or throws), `gateway.status().activeRuns` no longer includes this run. If
we'd put deletion in `.finally()`, the microtask ordering could leak a stale entry to a test
that checks status immediately after iteration. This is a real bug that the test
`status reports the active run while it is running` would have caught.

### AsyncEventQueue: the producer-consumer bridge

Producer (`push`, `close`, `fail`) and consumer (`Symbol.asyncIterator → next()`) cooperate
through three states:

- Buffer non-empty → consumer's `next()` resolves immediately with the head.
- Buffer empty, not closed → consumer's `next()` returns a Promise that waits in `#waiters`;
  the next `push` resolves it.
- Closed → consumer's `next()` either resolves `{done: true}` or rejects with the stored error.

It is not exported. Callers see only the resulting `AsyncIterable`.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| `agentCommand` orchestration | `GatewayCore.submit` | Same job: resolve session, admit run, expose result stream |
| Per-session + global queue admission | `runThroughLanes` chain | Same shape, packaged as `@vole/lanes` |
| `runEmbeddedPiAgent` invocation | Caller's `run` function passed to `submit` | Vole inverts the dependency — gateway never imports core |
| Push-based cancellation | `cancel(runId)` + `AbortController` | Same semantics |
| Session write locks (cross-process) | Phase 11 Step 4 in `@vole/sessions` | Layered below the session lane |

The biggest divergence: OpenClaw's gateway calls the embedded runner directly. Vole's gateway is
runtime-agnostic — adapters wire the runtime to the gateway via a `run` callback. This keeps the
dependency graph acyclic and lets the gateway be tested without spinning up `AgentRuntime`.

## 6. Key Design Decisions

**The gateway does not import @vole/core.** A direct dependency would force `@vole/gateway` to
re-export every runtime event type and would couple admission to a specific runtime
implementation. The `run` callback is the seam that keeps the layers independent and the
dependency graph clean.

**`submit` returns an `AsyncIterable`, not a `Promise<AsyncIterable>`.** The caller can start
iterating immediately. Lane admission progresses in the background; when the first slot opens,
events flow. If the caller never iterates, the run still progresses to completion but the events
go nowhere — the queue is the buffer. This is the right trade-off: backpressure is a future
problem; correctness first.

**Deletion before close, not in `.finally`.** Microtask ordering between the queue's
`close()`-driven iterator resolution and a `.finally()` callback is not guaranteed. Putting
the deletion in `.then()` and `.catch()` ahead of the queue mutation makes the post-iteration
state of `activeRuns` deterministic.

**Two abort checks, not one.** Cancelling before admission and cancelling during a run produce
the same end state (no further events), but the paths differ: one returns early without
invoking the run function, the other interrupts the in-flight iteration. Both deserve explicit
handling for clarity.

**Subscribe is deferred.** Joining a running session's stream from a second consumer is in the
architecture doc but not in Phase 11. The use case (Web UI rejoining a session being driven by
CLI) only matters once channels exist. Adding it requires multi-subscriber fan-out from the
queue, which is non-trivial. Phase 12 or Phase 15 will revisit.

## 7. Testing Approach

Tests are in `packages/gateway/src/index.test.ts`. Coverage:

- `SessionGateway` registry semantics (Phase 10 baseline tests, unchanged).
- `GatewayCore` inherits registry behaviour.
- `submit` streams events from the run function.
- `status` reports active runs during execution and an empty list after.
- Two submits on the same `sessionKey` serialize: the second does not start until the first
  finishes.
- Sub-agent submits respect the sub-agent lane cap (2 active out of 5 with cap = 2).
- A run function that throws propagates the error to the consumer's iteration.
- `cancel("nonexistent")` returns `false`.
- `cancel("active")` aborts the run; the run function's `AbortSignal` fires; the run unwinds.
- `status()` on an idle gateway returns empty lane occupancy and no active runs.

Tests use a `deferred<T>()` helper to gate the run function deterministically — no `setTimeout`
sleeps that race the test, except for short "let the event loop turn" pauses where unavoidable.

## 8. Insights

**The gateway is glue, not a layer of its own.** It has no domain logic. It composes
`SessionGateway`, `@vole/lanes`, and an `AbortController`. That is the whole product. The reason
to have it as a package is to enforce a single accept point — not because the code is large.

**`runThroughLanes` fire-and-forget is the entire trick.** Once you see that one detail, the
rest follows: the queue must exist (because the work is detached from the iterator), the
deletion ordering matters (because `.finally` is too late), and the abort checks must be in
the work function (because the caller's run function is invoked from a fire-and-forget context).

**This package will not grow much in size.** Phase 11 adds ~100 lines on top of the Phase 10
baseline. Phase 12 will layer per-parent counters into the activeRuns tracker for
`maxChildrenPerAgent`, but that is a few lines. Phase 15 channels will add session-key prefixes
but won't change the gateway's shape. The package's complexity ceiling is intentionally low.

**The gateway is the right place for `cancel`.** It already tracks active runs and owns the
AbortControllers. Putting cancel elsewhere (e.g., on the runtime) would require every adapter
to maintain its own runId-to-controller map. Centralising removes that duplication.

## 9. Review Questions

1. What stops `submit` from being a normal async function returning `Promise<TEvent[]>`?
   > Two things. First, callers want events as they happen, not at the end — useful for live UI
   > updates. Second, a buffered `Promise<TEvent[]>` would have to wait for the whole run before
   > the lane slot could be observed releasing. Streaming via `AsyncIterable` lets the consumer
   > observe completion (`done: true`) the instant the run finishes.

2. The run function receives an `AbortSignal`. What is it expected to do with it?
   > Check it at safe checkpoints — before the next model call, before the next tool call,
   > between phases of compaction — and bail out cleanly when aborted. The gateway also wraps
   > the iteration of the run's event stream with an abort check, so even an unaware run will
   > stop producing observed events shortly after cancel. But honouring the signal is the
   > right thing for callers to do.

3. What happens to a run cancelled before its lane slot opens?
   > The lane eventually dispatches the wrapped work; the work's first action is
   > `if (controller.signal.aborted) return;`, which returns without invoking `req.run`. The
   > lane slot is held briefly (one event-loop tick) and released. The queue closes and the
   > caller sees the iteration end immediately.

4. Why does the gateway not import `@vole/core`?
   > Cyclic dependency risk and runtime portability. If gateway imported core, then anywhere
   > you wanted to compose gateway behaviour (e.g., a future scheduler) you would pull in the
   > runtime. By accepting a `run` callback, the gateway stays a thin orchestration layer that
   > any caller can wire up. It also makes gateway tests trivial — they pass a fake `run` that
   > yields fake events.

5. If a run function pushes 1000 events quickly but the caller iterates slowly, what happens?
   > Events accumulate in the queue's `#buffer`. There is no backpressure in Phase 11 — the
   > run keeps emitting, the buffer grows, the caller drains at its own pace. For typical
   > Vole loads (a handful of events per turn) this is fine. If a future high-volume use case
   > demands it, we can add a high-water mark that pauses the run, but that is not Phase 11.

import { describe, expect, test } from "vitest";
import {
  DEFAULT_LANE_CONCURRENCY,
  FifoLane,
  LaneRegistry,
  runThroughLanes,
  type Lane
} from "./index.js";

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("FifoLane", () => {
  test("rejects non-positive maxConcurrent", () => {
    expect(() => new FifoLane({ key: "x", maxConcurrent: 0 })).toThrow();
    expect(() => new FifoLane({ key: "x", maxConcurrent: -1 })).toThrow();
    expect(() => new FifoLane({ key: "x", maxConcurrent: 1.5 })).toThrow();
  });

  test("runs work immediately when below concurrency cap", async () => {
    const lane = new FifoLane({ key: "test", maxConcurrent: 2 });
    const result = await lane.enqueue(async () => 42);
    expect(result).toBe(42);
    expect(lane.occupancy()).toEqual({ active: 0, queued: 0 });
  });

  test("enforces FIFO order under heavy enqueue load on concurrency 1", async () => {
    const lane = new FifoLane({ key: "session", maxConcurrent: 1 });
    const completed: number[] = [];
    const gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];

    for (let i = 0; i < 100; i++) {
      gates.push(deferred<void>());
    }

    const submits = gates.map((gate, i) =>
      lane.enqueue(async () => {
        await gate.promise;
        completed.push(i);
      })
    );

    // Release gates in order; with concurrency 1 each item must finish before the next starts.
    for (const gate of gates) {
      // Yield so the lane has a chance to start the next item before we resolve the next gate.
      await new Promise((r) => setTimeout(r, 0));
      gate.resolve();
    }

    await Promise.all(submits);
    expect(completed).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  test("enforces concurrency cap above 1", async () => {
    const lane = new FifoLane({ key: "cap", maxConcurrent: 3 });
    let activePeak = 0;
    let currentActive = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());

    const submits = gates.map((gate) =>
      lane.enqueue(async () => {
        currentActive++;
        activePeak = Math.max(activePeak, currentActive);
        await gate.promise;
        currentActive--;
      })
    );

    // Let the lane start as many as it can.
    await new Promise((r) => setTimeout(r, 5));
    expect(lane.occupancy().active).toBe(3);
    expect(lane.occupancy().queued).toBe(7);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(submits);

    expect(activePeak).toBe(3);
    expect(lane.occupancy()).toEqual({ active: 0, queued: 0 });
  });

  test("releases slot when work rejects", async () => {
    const lane = new FifoLane({ key: "err", maxConcurrent: 1 });
    await expect(
      lane.enqueue(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(lane.occupancy()).toEqual({ active: 0, queued: 0 });

    // Subsequent enqueues still work.
    const result = await lane.enqueue(async () => 7);
    expect(result).toBe(7);
  });

  test("subsequent waiters run in submission order after failure", async () => {
    const lane = new FifoLane({ key: "ord", maxConcurrent: 1 });
    const first = lane.enqueue(async () => {
      throw new Error("first fails");
    });
    const seen: string[] = [];
    const second = lane.enqueue(async () => {
      seen.push("second");
    });
    const third = lane.enqueue(async () => {
      seen.push("third");
    });

    await expect(first).rejects.toThrow("first fails");
    await Promise.all([second, third]);
    expect(seen).toEqual(["second", "third"]);
  });
});

describe("LaneRegistry", () => {
  test("exposes default concurrency for global and subagent", () => {
    const registry = new LaneRegistry();
    expect(registry.global.maxConcurrent).toBe(DEFAULT_LANE_CONCURRENCY.global);
    expect(registry.subagent.maxConcurrent).toBe(DEFAULT_LANE_CONCURRENCY.subagent);
  });

  test("creates a session lane on first access and reuses it", () => {
    const registry = new LaneRegistry();
    const lane1 = registry.sessionLane("sess-A") as Lane;
    const lane2 = registry.sessionLane("sess-A");
    expect(lane1).toBe(lane2);
    expect(lane1.key).toBe("session:sess-A");
    expect(lane1.maxConcurrent).toBe(DEFAULT_LANE_CONCURRENCY.session);
  });

  test("releaseSessionLane removes idle lanes only", async () => {
    const registry = new LaneRegistry();
    const lane = registry.sessionLane("sess-B");
    expect(registry.releaseSessionLane("sess-B")).toBe(true);
    // Re-acquire returns a new instance.
    const next = registry.sessionLane("sess-B");
    expect(next).not.toBe(lane);
  });

  test("releaseSessionLane refuses while work is active", async () => {
    const registry = new LaneRegistry({ sessionConcurrency: 1 });
    const lane = registry.sessionLane("sess-C");
    const gate = deferred<void>();
    const running = lane.enqueue(async () => {
      await gate.promise;
    });
    expect(registry.releaseSessionLane("sess-C")).toBe(false);
    gate.resolve();
    await running;
    expect(registry.releaseSessionLane("sess-C")).toBe(true);
  });

  test("status snapshot reports global / subagent / sessions", () => {
    const registry = new LaneRegistry();
    registry.sessionLane("sess-S1");
    registry.sessionLane("sess-S2");
    const snapshot = registry.status();
    expect(snapshot.global).toEqual({ active: 0, queued: 0 });
    expect(snapshot.subagent).toEqual({ active: 0, queued: 0 });
    expect(snapshot.sessions.map((s) => s.key).sort()).toEqual([
      "session:sess-S1",
      "session:sess-S2"
    ]);
  });
});

describe("runThroughLanes", () => {
  test("chains global → session for non-subagent work", async () => {
    const registry = new LaneRegistry({ globalConcurrency: 1, sessionConcurrency: 1 });
    const order: string[] = [];

    const work1 = runThroughLanes(registry, { sessionId: "sX" }, async () => {
      order.push("w1");
    });
    const work2 = runThroughLanes(registry, { sessionId: "sX" }, async () => {
      order.push("w2");
    });

    await Promise.all([work1, work2]);
    expect(order).toEqual(["w1", "w2"]);
  });

  test("uses subagent lane only when isSubagent is true", async () => {
    const registry = new LaneRegistry({
      globalConcurrency: 16,
      subagentConcurrency: 2,
      sessionConcurrency: 1
    });

    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const submits = gates.map((gate, i) =>
      runThroughLanes(
        registry,
        { sessionId: `sub-${i}`, isSubagent: true },
        async () => {
          await gate.promise;
        }
      )
    );

    await new Promise((r) => setTimeout(r, 5));
    // Subagent lane caps to 2; 3 others should be queued.
    expect(registry.subagent.occupancy().active).toBe(2);
    expect(registry.subagent.occupancy().queued).toBe(3);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(submits);
    expect(registry.subagent.occupancy()).toEqual({ active: 0, queued: 0 });
  });

  test("a non-subagent run does not consume the subagent lane", async () => {
    const registry = new LaneRegistry({ subagentConcurrency: 1 });
    const gateA = deferred<void>();
    const subagentRun = runThroughLanes(
      registry,
      { sessionId: "child", isSubagent: true },
      async () => {
        await gateA.promise;
      }
    );

    // A parent (non-subagent) run should not be blocked by the subagent slot being held.
    let parentDone = false;
    await runThroughLanes(registry, { sessionId: "parent", isSubagent: false }, async () => {
      parentDone = true;
    });
    expect(parentDone).toBe(true);

    gateA.resolve();
    await subagentRun;
  });
});

describe("acceptance: Phase 11 plan §5", () => {
  test("100 parallel submits to one session lane complete in submission order", async () => {
    const lane = new FifoLane({ key: "session:big", maxConcurrent: 1 });
    const completed: number[] = [];
    const submits: Array<Promise<void>> = [];

    for (let i = 0; i < 100; i++) {
      submits.push(
        lane.enqueue(async () => {
          // Tiny variable yield so any concurrency bug would scramble ordering.
          await new Promise((r) => setTimeout(r, Math.random() < 0.5 ? 0 : 1));
          completed.push(i);
        })
      );
    }

    await Promise.all(submits);
    expect(completed).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  test("12 async subagents under default caps run at most 8 concurrently", async () => {
    const registry = new LaneRegistry(); // defaults: subagent=8
    let activeCount = 0;
    let peak = 0;
    const gates = Array.from({ length: 12 }, () => deferred<void>());

    const submits = gates.map((gate, i) =>
      runThroughLanes(
        registry,
        { sessionId: `sub-${i}`, isSubagent: true },
        async () => {
          activeCount++;
          peak = Math.max(peak, activeCount);
          await gate.promise;
          activeCount--;
        }
      )
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(peak).toBe(8);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(submits);
    expect(peak).toBe(8);
  });
});

import { describe, expect, test } from "vitest";
import { CLI_CAPABILITIES, WEB_CAPABILITIES } from "@vole/adapters";
import {
  GatewayCore,
  SessionGateway,
  type GatewaySession,
  type RunRequest
} from "./index.js";

function makeSession(overrides: Partial<GatewaySession> = {}): GatewaySession {
  return {
    id: "session_1",
    adapterName: "cli",
    capabilities: CLI_CAPABILITIES,
    registeredAt: "2026-05-05T10:00:00.000Z",
    lastActivityAt: "2026-05-05T10:00:00.000Z",
    ...overrides
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) {
    out.push(item);
  }
  return out;
}

describe("SessionGateway", () => {
  test("register makes the session retrievable by id", () => {
    const gateway = new SessionGateway();
    const session = makeSession();

    gateway.register(session);

    expect(gateway.get("session_1")).toEqual(session);
  });

  test("unregister removes the session", () => {
    const gateway = new SessionGateway();
    const session = makeSession();

    gateway.register(session);
    gateway.unregister("session_1");

    expect(gateway.get("session_1")).toBeUndefined();
  });

  test("get returns undefined for an unknown session", () => {
    const gateway = new SessionGateway();

    expect(gateway.get("session_unknown")).toBeUndefined();
  });

  test("list returns all registered sessions", () => {
    const gateway = new SessionGateway();
    const s1 = makeSession({ id: "session_1", adapterName: "cli" });
    const s2 = makeSession({ id: "session_2", adapterName: "web", capabilities: WEB_CAPABILITIES });

    gateway.register(s1);
    gateway.register(s2);

    expect(gateway.list()).toHaveLength(2);
    expect(gateway.list().map((s) => s.id)).toEqual(expect.arrayContaining(["session_1", "session_2"]));
  });

  test("list returns empty array when no sessions are registered", () => {
    const gateway = new SessionGateway();

    expect(gateway.list()).toEqual([]);
  });

  test("listByAdapter filters sessions by adapter name", () => {
    const gateway = new SessionGateway();
    gateway.register(makeSession({ id: "cli_1", adapterName: "cli" }));
    gateway.register(makeSession({ id: "cli_2", adapterName: "cli" }));
    gateway.register(makeSession({ id: "web_1", adapterName: "web", capabilities: WEB_CAPABILITIES }));

    const cliSessions = gateway.listByAdapter("cli");
    const webSessions = gateway.listByAdapter("web");

    expect(cliSessions).toHaveLength(2);
    expect(webSessions).toHaveLength(1);
    expect(webSessions[0]?.id).toBe("web_1");
  });

  test("listByAdapter returns empty array when no sessions match the adapter", () => {
    const gateway = new SessionGateway();
    gateway.register(makeSession({ id: "cli_1", adapterName: "cli" }));

    expect(gateway.listByAdapter("web")).toEqual([]);
  });

  test("touch updates lastActivityAt for an existing session", () => {
    const gateway = new SessionGateway();
    const session = makeSession({ lastActivityAt: "2026-05-05T10:00:00.000Z" });
    gateway.register(session);

    gateway.touch("session_1");
    const updated = gateway.get("session_1");

    expect(updated?.lastActivityAt).not.toBe("2026-05-05T10:00:00.000Z");
  });

  test("touch is a no-op for an unknown session id", () => {
    const gateway = new SessionGateway();

    // Should not throw
    expect(() => gateway.touch("unknown_session")).not.toThrow();
    expect(gateway.list()).toHaveLength(0);
  });
});

describe("GatewayCore — registry compatibility", () => {
  test("inherits SessionGateway register/get/list semantics", () => {
    const gateway = new GatewayCore();
    const session = makeSession();

    gateway.register(session);
    expect(gateway.get("session_1")).toEqual(session);
    expect(gateway.list()).toHaveLength(1);

    gateway.unregister("session_1");
    expect(gateway.get("session_1")).toBeUndefined();
  });
});

describe("GatewayCore.submit", () => {
  test("streams events from the run function to the consumer", async () => {
    const gateway = new GatewayCore();
    const req: RunRequest<string> = {
      runId: "run_1",
      sessionKey: "agent:default:main",
      agentId: "default",
      run: async function* () {
        yield "a";
        yield "b";
        yield "c";
      }
    };

    const events = await collect(gateway.submit(req));
    expect(events).toEqual(["a", "b", "c"]);
  });

  test("status reports the active run while it is running", async () => {
    const gateway = new GatewayCore();
    const gate = deferred<void>();

    const submission = collect(
      gateway.submit<string>({
        runId: "run_observed",
        sessionKey: "agent:default:main",
        agentId: "default",
        run: async function* () {
          yield "x";
          await gate.promise;
          yield "y";
        }
      })
    );

    // Wait long enough for the run to start and emit the first event.
    await new Promise((r) => setTimeout(r, 10));
    const statusMid = gateway.status();
    expect(statusMid.activeRuns).toHaveLength(1);
    expect(statusMid.activeRuns[0]?.runId).toBe("run_observed");
    expect(statusMid.activeRuns[0]?.sessionKey).toBe("agent:default:main");

    gate.resolve();
    await submission;
    expect(gateway.status().activeRuns).toEqual([]);
  });

  test("serializes runs on the same session lane", async () => {
    const gateway = new GatewayCore();
    const completed: string[] = [];
    const gate1 = deferred<void>();

    // First run blocks on gate1 mid-stream.
    const run1Done = collect(
      gateway.submit<string>({
        runId: "run_A",
        sessionKey: "agent:default:main",
        agentId: "default",
        run: async function* () {
          yield "A1";
          await gate1.promise;
          completed.push("A");
          yield "A2";
        }
      })
    );

    // Second submit on same session must wait for first to finish.
    let secondStarted = false;
    const run2Done = collect(
      gateway.submit<string>({
        runId: "run_B",
        sessionKey: "agent:default:main",
        agentId: "default",
        run: async function* () {
          secondStarted = true;
          yield "B1";
          completed.push("B");
        }
      })
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(secondStarted).toBe(false);

    gate1.resolve();
    await Promise.all([run1Done, run2Done]);
    expect(completed).toEqual(["A", "B"]);
    expect(secondStarted).toBe(true);
  });

  test("subagent runs share the subagent lane and respect its cap", async () => {
    const gateway = new GatewayCore({
      lanes: { globalConcurrency: 16, subagentConcurrency: 2, sessionConcurrency: 1 }
    });
    let activePeak = 0;
    let currentActive = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const submissions = gates.map((gate, i) =>
      collect(
        gateway.submit<string>({
          runId: `sub_${i}`,
          sessionKey: `agent:default:subagent:${i}`,
          agentId: "default",
          isSubagent: true,
          run: async function* () {
            currentActive++;
            activePeak = Math.max(activePeak, currentActive);
            yield `tick_${i}`;
            await gate.promise;
            currentActive--;
          }
        })
      )
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(activePeak).toBe(2);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(submissions);
    expect(activePeak).toBe(2);
  });

  test("propagates errors from the run function to the consumer", async () => {
    const gateway = new GatewayCore();
    await expect(
      collect(
        gateway.submit<string>({
          runId: "run_err",
          sessionKey: "agent:default:main",
          agentId: "default",
          run: async function* () {
            yield "ok";
            throw new Error("run blew up");
          }
        })
      )
    ).rejects.toThrow("run blew up");

    // Run should be removed from active list after failure.
    expect(gateway.status().activeRuns).toEqual([]);
  });
});

describe("GatewayCore.cancel", () => {
  test("returns false for unknown runId", () => {
    const gateway = new GatewayCore();
    expect(gateway.cancel("nonexistent")).toBe(false);
  });

  test("aborts an active run via the run function's AbortSignal", async () => {
    const gateway = new GatewayCore();
    let receivedAbort = false;
    const started = deferred<void>();

    const submission = collect(
      gateway.submit<string>({
        runId: "run_cancel",
        sessionKey: "agent:default:main",
        agentId: "default",
        run: async function* (signal) {
          started.resolve();
          // Wait until aborted.
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          receivedAbort = signal.aborted;
        }
      })
    );

    await started.promise;
    expect(gateway.cancel("run_cancel")).toBe(true);
    await submission;
    expect(receivedAbort).toBe(true);
  });
});

describe("GatewayCore.status", () => {
  test("reports lane occupancy snapshot with empty registry", () => {
    const gateway = new GatewayCore();
    const status = gateway.status();
    expect(status.lanes.global).toEqual({ active: 0, queued: 0 });
    expect(status.lanes.subagent).toEqual({ active: 0, queued: 0 });
    expect(status.lanes.sessions).toEqual([]);
    expect(status.activeRuns).toEqual([]);
  });
});

describe("GatewayCore — per-parent maxChildrenPerAgent (Phase 12)", () => {
  test("rejects a sub-agent run when the parent already has maxChildrenPerAgent active children", async () => {
    const gateway = new GatewayCore({ maxChildrenPerAgent: 2 });
    const parent = "agent:default:main";
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];

    // Two children start and hold open.
    const child1 = collect(
      gateway.submit<string>({
        runId: "child_1",
        sessionKey: "agent:default:subagent:1",
        agentId: "default",
        isSubagent: true,
        parentSessionKey: parent,
        run: async function* () {
          yield "ping1";
          await gates[0]!.promise;
        }
      })
    );
    const child2 = collect(
      gateway.submit<string>({
        runId: "child_2",
        sessionKey: "agent:default:subagent:2",
        agentId: "default",
        isSubagent: true,
        parentSessionKey: parent,
        run: async function* () {
          yield "ping2";
          await gates[1]!.promise;
        }
      })
    );

    await new Promise((r) => setTimeout(r, 20));

    // Third child must be rejected with ChildLimitExceededError.
    await expect(
      collect(
        gateway.submit<string>({
          runId: "child_3",
          sessionKey: "agent:default:subagent:3",
          agentId: "default",
          isSubagent: true,
          parentSessionKey: parent,
          run: async function* () { yield "ping3"; await gates[2]!.promise; }
        })
      )
    ).rejects.toThrow(/max_children_per_agent_exceeded|already has 2 active children/);

    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all([child1, child2]);
  });

  test("a different parent's children do not count against the limit", async () => {
    const gateway = new GatewayCore({ maxChildrenPerAgent: 1 });
    const gate1 = deferred<void>();

    const c1 = collect(
      gateway.submit<string>({
        runId: "c_p1",
        sessionKey: "agent:default:subagent:x",
        agentId: "default",
        isSubagent: true,
        parentSessionKey: "agent:default:p1",
        run: async function* () { yield "ok"; await gate1.promise; }
      })
    );

    // Different parent: should be admitted even though limit is 1.
    let secondStarted = false;
    const gate2 = deferred<void>();
    const c2 = collect(
      gateway.submit<string>({
        runId: "c_p2",
        sessionKey: "agent:default:subagent:y",
        agentId: "default",
        isSubagent: true,
        parentSessionKey: "agent:default:p2",
        run: async function* () { secondStarted = true; yield "ok2"; await gate2.promise; }
      })
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(secondStarted).toBe(true);

    gate1.resolve();
    gate2.resolve();
    await Promise.all([c1, c2]);
  });
});

describe("GatewayCore — runTimeoutSeconds (Phase 12)", () => {
  test("aborts a long-running child when runTimeoutSeconds elapses", async () => {
    const gateway = new GatewayCore();
    let abortReason: unknown;

    const submission = collect(
      gateway.submit<string>({
        runId: "run_timeout",
        sessionKey: "agent:default:subagent:t",
        agentId: "default",
        isSubagent: true,
        runTimeoutSeconds: 0.05, // 50ms
        run: async function* (signal) {
          yield "started";
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                abortReason = signal.reason;
                resolve();
              },
              { once: true }
            );
          });
        }
      })
    );

    await submission;

    expect((abortReason as { code?: string })?.code).toBe("run_timeout");
  });

  test("does not abort a quick run before the timeout fires", async () => {
    const gateway = new GatewayCore();
    let aborted = false;

    const events = await collect(
      gateway.submit<string>({
        runId: "run_quick",
        sessionKey: "agent:default:subagent:q",
        agentId: "default",
        isSubagent: true,
        runTimeoutSeconds: 2,
        run: async function* (signal) {
          yield "fast";
          if (signal.aborted) aborted = true;
        }
      })
    );

    expect(events).toEqual(["fast"]);
    expect(aborted).toBe(false);
  });
});

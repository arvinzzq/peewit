/**
 * INPUT: Session registrations from adapters, RunRequests with caller-provided run functions, lane configuration.
 * OUTPUT: SessionGateway registry plus GatewayCore (submit / subscribe / cancel / status) that admits every run through global / subagent / session lanes; GatewaySession records and GatewayStatus snapshot.
 * POS: Single accept point for agent runs across CLI, Web, scheduler, and future channels; sits above @vole/lanes and below adapter wiring.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { AdapterCapabilities } from "@vole/adapters";
import {
  DEFAULT_LANE_CONCURRENCY,
  LaneRegistry,
  runThroughLanes,
  type LaneRegistryOptions,
  type LaneRegistryStatus
} from "@vole/lanes";

export const gatewayPackageName = "@vole/gateway";

export interface GatewaySession {
  id: string;
  adapterName: string;
  capabilities: AdapterCapabilities;
  registeredAt: string;
  lastActivityAt: string;
}

export class SessionGateway {
  readonly #sessions = new Map<string, GatewaySession>();

  register(session: GatewaySession): void {
    this.#sessions.set(session.id, session);
  }

  unregister(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  touch(sessionId: string): void {
    const s = this.#sessions.get(sessionId);
    if (s !== undefined) {
      this.#sessions.set(sessionId, { ...s, lastActivityAt: new Date().toISOString() });
    }
  }

  get(sessionId: string): GatewaySession | undefined {
    return this.#sessions.get(sessionId);
  }

  list(): GatewaySession[] {
    return Array.from(this.#sessions.values());
  }

  listByAdapter(adapterName: string): GatewaySession[] {
    return this.list().filter((s) => s.adapterName === adapterName);
  }
}

// ----------------------------------------------------------------------------
// GatewayCore — Phase 11 expansion
// ----------------------------------------------------------------------------

export interface RunRequest<TEvent = unknown> {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent?: boolean;
  /** Phase 12: when isSubagent === true, the session key of the parent. Used by the per-parent child counter to enforce maxChildrenPerAgent. */
  parentSessionKey?: string;
  /** Phase 12: wall-clock budget for this run. When > 0, the gateway arms a setTimeout that calls cancel(runId) on expiry; the run surfaces a timed-out status. */
  runTimeoutSeconds?: number;
  /**
   * Caller-supplied work that emits runtime events.
   * The gateway invokes this inside the lane chain and forwards events to consumers.
   * The function MUST honor the provided AbortSignal at safe checkpoints.
   */
  run: (signal: AbortSignal) => AsyncIterable<TEvent>;
}

export interface RunHandle {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent: boolean;
  startedAt: string;
  parentSessionKey?: string;
}

export interface GatewayStatus {
  lanes: LaneRegistryStatus;
  activeRuns: RunHandle[];
}

export interface GatewayCoreOptions {
  lanes?: LaneRegistryOptions;
  now?: () => string;
  /** Phase 12: max active children per parent session before new spawns are rejected. Default 5. */
  maxChildrenPerAgent?: number;
}

export const DEFAULT_MAX_CHILDREN_PER_AGENT = 5;

export class ChildLimitExceededError extends Error {
  readonly code = "max_children_per_agent_exceeded";
  readonly parentSessionKey: string;
  readonly limit: number;
  constructor(parentSessionKey: string, limit: number) {
    super(`Parent session "${parentSessionKey}" already has ${limit} active children (max).`);
    this.name = "ChildLimitExceededError";
    this.parentSessionKey = parentSessionKey;
    this.limit = limit;
  }
}

export class RunTimeoutError extends Error {
  readonly code = "run_timeout";
  readonly runId: string;
  readonly timeoutSeconds: number;
  constructor(runId: string, timeoutSeconds: number) {
    super(`Run "${runId}" exceeded its ${timeoutSeconds}s timeout.`);
    this.name = "RunTimeoutError";
    this.runId = runId;
    this.timeoutSeconds = timeoutSeconds;
  }
}

/**
 * Internal async queue: producer pushes events; consumer iterates.
 * Closing the queue ends iteration cleanly; failing the queue throws on next iteration.
 */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  #buffer: T[] = [];
  #waiters: Array<{ resolve: (v: IteratorResult<T>) => void; reject: (err: unknown) => void }> = [];
  #closed = false;
  #error: unknown;

  push(value: T): void {
    if (this.#closed) {
      return;
    }
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.#buffer.push(value);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) {
        waiter.resolve({ value: undefined as never, done: true });
      }
    }
  }

  fail(err: unknown): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#error = err;
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) {
        waiter.reject(err);
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.#buffer.length > 0) {
          return Promise.resolve({ value: this.#buffer.shift() as T, done: false });
        }
        if (this.#closed) {
          if (this.#error !== undefined) {
            return Promise.reject(this.#error);
          }
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.#waiters.push({ resolve, reject });
        });
      }
    };
  }
}

export class GatewayCore extends SessionGateway {
  readonly #lanes: LaneRegistry;
  readonly #activeRuns = new Map<string, { handle: RunHandle; controller: AbortController; timeoutHandle?: ReturnType<typeof setTimeout> }>();
  readonly #now: () => string;
  readonly #maxChildrenPerAgent: number;

  constructor(options: GatewayCoreOptions = {}) {
    super();
    this.#lanes = new LaneRegistry(options.lanes ?? {});
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#maxChildrenPerAgent = options.maxChildrenPerAgent ?? DEFAULT_MAX_CHILDREN_PER_AGENT;
  }

  /**
   * Submit a run for execution. The returned async iterable yields events as the
   * caller's run function produces them. Execution waits for global / subagent /
   * session lane slots before starting.
   *
   * Phase 12 admission: when isSubagent === true and parentSessionKey is set, the
   * gateway counts active children for that parent and rejects (via the returned
   * iterable's first iteration throwing) if the count is at maxChildrenPerAgent.
   * Per-parent admission happens BEFORE the lane chain so one runaway parent does
   * not starve other parents on the shared subagent lane.
   */
  submit<TEvent = unknown>(req: RunRequest<TEvent>): AsyncIterable<TEvent> {
    const queue = new AsyncEventQueue<TEvent>();

    // Phase 12 per-parent admission: enforce maxChildrenPerAgent for sub-agent runs
    // with a known parent. Reject up front so the caller's iteration immediately throws.
    if (req.isSubagent === true && req.parentSessionKey !== undefined) {
      const active = this.#countActiveChildrenOf(req.parentSessionKey);
      if (active >= this.#maxChildrenPerAgent) {
        queue.fail(new ChildLimitExceededError(req.parentSessionKey, this.#maxChildrenPerAgent));
        return queue;
      }
    }

    const controller = new AbortController();
    const handle: RunHandle = {
      runId: req.runId,
      sessionKey: req.sessionKey,
      agentId: req.agentId,
      isSubagent: req.isSubagent === true,
      startedAt: this.#now(),
      ...(req.parentSessionKey !== undefined ? { parentSessionKey: req.parentSessionKey } : {})
    };
    const entry: { handle: RunHandle; controller: AbortController; timeoutHandle?: ReturnType<typeof setTimeout> } = {
      handle,
      controller
    };
    this.#activeRuns.set(req.runId, entry);

    // Phase 12 timeout: arm a timer that aborts the run when runTimeoutSeconds > 0.
    // The run function's AbortSignal carries the timeout reason so the caller can
    // surface a "timed_out" terminal status instead of a generic cancellation.
    if (req.runTimeoutSeconds !== undefined && req.runTimeoutSeconds > 0) {
      const timeoutMs = req.runTimeoutSeconds * 1000;
      const timeoutReason = new RunTimeoutError(req.runId, req.runTimeoutSeconds);
      entry.timeoutHandle = setTimeout(() => {
        controller.abort(timeoutReason);
      }, timeoutMs);
    }

    const lanes = this.#lanes;
    const laneOptions = req.isSubagent === true
      ? { sessionId: req.sessionKey, isSubagent: true as const }
      : { sessionId: req.sessionKey };
    const activeRuns = this.#activeRuns;
    const cleanup = (): void => {
      const e = activeRuns.get(req.runId);
      if (e?.timeoutHandle !== undefined) {
        clearTimeout(e.timeoutHandle);
      }
      activeRuns.delete(req.runId);
    };

    void runThroughLanes(
      lanes,
      laneOptions,
      async () => {
        if (controller.signal.aborted) {
          return;
        }
        for await (const event of req.run(controller.signal)) {
          if (controller.signal.aborted) {
            break;
          }
          queue.push(event);
        }
      }
    )
      .then(() => {
        cleanup();
        queue.close();
      })
      .catch((err: unknown) => {
        cleanup();
        queue.fail(err);
      });

    return queue;
  }

  #countActiveChildrenOf(parentSessionKey: string): number {
    let count = 0;
    for (const entry of this.#activeRuns.values()) {
      if (entry.handle.parentSessionKey === parentSessionKey) {
        count++;
      }
    }
    return count;
  }

  /**
   * Cancel an active run. Returns true if a run with the given id was found
   * and signalled to abort; false if no such run exists. The caller's run
   * function is expected to observe the AbortSignal and stop at a safe point.
   */
  cancel(runId: string): boolean {
    const entry = this.#activeRuns.get(runId);
    if (entry === undefined) {
      return false;
    }
    entry.controller.abort();
    return true;
  }

  /**
   * Snapshot of current lane occupancy and active run handles. Intended for
   * inspection commands like `vole gateway status`.
   */
  status(): GatewayStatus {
    return {
      lanes: this.#lanes.status(),
      activeRuns: Array.from(this.#activeRuns.values()).map((entry) => entry.handle)
    };
  }

  /**
   * Return the underlying LaneRegistry options the gateway was constructed with,
   * to aid future migration of cli/web adapters. Not intended for runtime use.
   */
  get defaultLaneConcurrency(): typeof DEFAULT_LANE_CONCURRENCY {
    return DEFAULT_LANE_CONCURRENCY;
  }
}

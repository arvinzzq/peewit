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
}

export interface GatewayStatus {
  lanes: LaneRegistryStatus;
  activeRuns: RunHandle[];
}

export interface GatewayCoreOptions {
  lanes?: LaneRegistryOptions;
  now?: () => string;
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
  readonly #activeRuns = new Map<string, { handle: RunHandle; controller: AbortController }>();
  readonly #now: () => string;

  constructor(options: GatewayCoreOptions = {}) {
    super();
    this.#lanes = new LaneRegistry(options.lanes ?? {});
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Submit a run for execution. The returned async iterable yields events as the
   * caller's run function produces them. Execution waits for global / subagent /
   * session lane slots before starting.
   */
  submit<TEvent = unknown>(req: RunRequest<TEvent>): AsyncIterable<TEvent> {
    const controller = new AbortController();
    const handle: RunHandle = {
      runId: req.runId,
      sessionKey: req.sessionKey,
      agentId: req.agentId,
      isSubagent: req.isSubagent === true,
      startedAt: this.#now()
    };
    this.#activeRuns.set(req.runId, { handle, controller });

    const queue = new AsyncEventQueue<TEvent>();
    const lanes = this.#lanes;

    const laneOptions = req.isSubagent === true
      ? { sessionId: req.sessionKey, isSubagent: true as const }
      : { sessionId: req.sessionKey };
    const activeRuns = this.#activeRuns;
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
        activeRuns.delete(req.runId);
        queue.close();
      })
      .catch((err: unknown) => {
        activeRuns.delete(req.runId);
        queue.fail(err);
      });

    return queue;
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

/**
 * INPUT: Work functions submitted with optional lane membership (session id, isSubagent flag) and per-tier concurrency limits.
 * OUTPUT: Lane interface, FifoLane class, LaneRegistry with global/subagent/session tiers, LaneRegistryStatus snapshot, runThroughLanes helper that composes the three tiers.
 * POS: Run admission primitive below GatewayCore; serializes per-session writes and bounds global / sub-agent parallelism. Does not know about AgentRuntime, sessions storage, or model providers.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
export const lanesPackageName = "@vole/lanes";

export interface LaneOccupancy {
  active: number;
  queued: number;
}

export interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): LaneOccupancy;
}

export interface FifoLaneOptions {
  key: string;
  maxConcurrent: number;
}

export class FifoLane implements Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  #active = 0;
  #waiters: Array<() => void> = [];

  constructor(options: FifoLaneOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error(`Lane "${options.key}" maxConcurrent must be a positive integer; got ${options.maxConcurrent}.`);
    }
    this.key = options.key;
    this.maxConcurrent = options.maxConcurrent;
  }

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
      if (next !== undefined) {
        next();
      }
    }
  }

  occupancy(): LaneOccupancy {
    return { active: this.#active, queued: this.#waiters.length };
  }
}

export interface LaneRegistryOptions {
  globalConcurrency?: number;
  subagentConcurrency?: number;
  sessionConcurrency?: number;
}

export const DEFAULT_LANE_CONCURRENCY = {
  global: 16,
  subagent: 8,
  session: 1
} as const;

export interface LaneRegistryStatus {
  global: LaneOccupancy;
  subagent: LaneOccupancy;
  sessions: Array<{ key: string } & LaneOccupancy>;
}

export class LaneRegistry {
  readonly global: Lane;
  readonly subagent: Lane;
  readonly #sessionLanes = new Map<string, FifoLane>();
  readonly #sessionConcurrency: number;

  constructor(options: LaneRegistryOptions = {}) {
    this.global = new FifoLane({
      key: "global",
      maxConcurrent: options.globalConcurrency ?? DEFAULT_LANE_CONCURRENCY.global
    });
    this.subagent = new FifoLane({
      key: "subagent",
      maxConcurrent: options.subagentConcurrency ?? DEFAULT_LANE_CONCURRENCY.subagent
    });
    this.#sessionConcurrency = options.sessionConcurrency ?? DEFAULT_LANE_CONCURRENCY.session;
  }

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
    if (lane === undefined) {
      return false;
    }
    const { active, queued } = lane.occupancy();
    if (active === 0 && queued === 0) {
      this.#sessionLanes.delete(sessionId);
      return true;
    }
    return false;
  }

  status(): LaneRegistryStatus {
    const sessions = Array.from(this.#sessionLanes.values()).map((lane) => ({
      key: lane.key,
      ...lane.occupancy()
    }));
    return {
      global: this.global.occupancy(),
      subagent: this.subagent.occupancy(),
      sessions
    };
  }
}

export interface LaneChainOptions {
  sessionId: string;
  isSubagent?: boolean;
}

export async function runThroughLanes<T>(
  registry: LaneRegistry,
  options: LaneChainOptions,
  work: () => Promise<T>
): Promise<T> {
  const sessionLane = registry.sessionLane(options.sessionId);
  const runInner = () => sessionLane.enqueue(work);
  const runWithSubagent = () =>
    options.isSubagent === true ? registry.subagent.enqueue(runInner) : runInner();
  return registry.global.enqueue(runWithSubagent);
}

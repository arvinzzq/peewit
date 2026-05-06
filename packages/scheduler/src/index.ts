/**
 * INPUT: Task definition config, task run records, background approval requests, cron expressions.
 * OUTPUT: TaskDefinition/TaskRunRecord types, JsonlTaskStore, BackgroundApprovalResolver, CronScheduler, matchesCron.
 * POS: Background task layer; owns task run persistence, approval policy for unattended execution, and cron-based scheduling.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApprovalRequest, ApprovalResolution, ApprovalResolver } from "@peewit/core";

export const schedulerPackageName = "@peewit/scheduler";

// Task definition loaded from task files or CLI arguments
export interface TaskDefinition {
  name: string;
  goal: string;
  cron?: string;
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}

// Persisted record of one task execution
export interface TaskRunRecord {
  id: string;
  taskName: string;
  goal: string;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  assistantText: string;
  errorMessage?: string;
}

// Store for task run history
export interface TaskStore {
  saveRun(record: TaskRunRecord): Promise<void>;
  updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>;
  listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>;
}

// JSONL-backed task store at a given file path
export class JsonlTaskStore implements TaskStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async saveRun(record: TaskRunRecord): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
  }

  async updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void> {
    const records = await this.#readAll();
    const updated = records.map((record) =>
      record.id === id ? { ...record, ...updates } : record
    );
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, updated.map((r) => JSON.stringify(r)).join("\n") + (updated.length > 0 ? "\n" : ""));
  }

  async listRuns(query: { limit?: number; taskName?: string } = {}): Promise<TaskRunRecord[]> {
    const records = await this.#readAll();
    const filtered =
      query.taskName === undefined
        ? records
        : records.filter((record) => record.taskName === query.taskName);
    return query.limit === undefined ? filtered : filtered.slice(-query.limit);
  }

  async #readAll(): Promise<TaskRunRecord[]> {
    let content = "";

    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records: TaskRunRecord[] = [];

    for (const line of content.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      records.push(JSON.parse(line) as TaskRunRecord);
    }

    return records;
  }
}

// Auto-denies when no user is present; auto-approves in auto mode
export class BackgroundApprovalResolver implements ApprovalResolver {
  readonly #mode: "observe" | "confirm" | "auto";

  constructor(mode: "observe" | "confirm" | "auto" = "confirm") {
    this.#mode = mode;
  }

  async resolve(_request: ApprovalRequest): Promise<ApprovalResolution> {
    if (this.#mode === "auto") {
      return {
        approved: true,
        reason: "Auto-approved in background auto mode."
      };
    }

    return {
      approved: false,
      reason: `Auto-denied in background ${this.#mode} mode: no user is present to approve.`
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// Returns true if 'value' matches the cron field
function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

// Returns true if the given Date matches the cron expression
export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    matchesCronField(min!, date.getMinutes()) &&
    matchesCronField(hour!, date.getHours()) &&
    matchesCronField(dom!, date.getDate()) &&
    matchesCronField(month!, date.getMonth() + 1) &&
    matchesCronField(dow!, date.getDay())
  );
}

export interface CronSchedulerOptions {
  checkIntervalMs?: number;  // how often to check for due tasks (default 30000 = 30s)
  getNow?: () => Date;       // injectable for testing
}

export type TaskRunner = (task: TaskDefinition) => Promise<void>;

export class CronScheduler {
  readonly #tasks: TaskDefinition[];
  readonly #runner: TaskRunner;
  readonly #intervalMs: number;
  readonly #getNow: () => Date;
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #lastRun = new Map<string, number>(); // task name → last run minute key

  constructor(tasks: TaskDefinition[], runner: TaskRunner, options?: CronSchedulerOptions) {
    this.#tasks = tasks;
    this.#runner = runner;
    this.#intervalMs = options?.checkIntervalMs ?? 30_000;
    this.#getNow = options?.getNow ?? (() => new Date());
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.#tick(), this.#intervalMs);
    // Run once immediately on start
    void this.#tick();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  get isRunning(): boolean {
    return this.#timer !== undefined;
  }

  async #tick(): Promise<void> {
    const now = this.#getNow();
    for (const task of this.#tasks) {
      if (!task.cron) continue;
      if (!matchesCron(task.cron, now)) continue;

      // Prevent running same task twice in the same minute
      const lastRun = this.#lastRun.get(task.name) ?? 0;
      const minuteKey = Math.floor(now.getTime() / 60_000);
      if (lastRun === minuteKey) continue;

      this.#lastRun.set(task.name, minuteKey);

      try {
        await this.#runner(task);
      } catch {
        // Individual task failures don't stop the scheduler
      }
    }
  }
}

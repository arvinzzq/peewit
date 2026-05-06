/**
 * INPUT: Task definitions, task status updates, parent/child relationships.
 * OUTPUT: TaskRecord and TaskFlow types, JsonlTaskFlowStore, task lifecycle management.
 * POS: TaskFlow layer; owns persistent cross-session task graph state.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export const taskflowPackageName = "@peewit/taskflow";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

export type TaskRuntime = "subagent" | "background" | "cli" | "cron" | "web";

export interface TaskRecord {
  id: string;
  runtime: TaskRuntime;
  task: string;          // goal/description
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  progressSummary?: string;
  terminalSummary?: string;
  parentId?: string;     // parent task ID for sub-tasks
  sessionId?: string;    // associated session
}

export interface TaskFlowStore {
  create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord>;
  update(id: string, updates: Partial<Pick<TaskRecord, "status" | "progressSummary" | "terminalSummary">>): Promise<TaskRecord | undefined>;
  get(id: string): Promise<TaskRecord | undefined>;
  list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]>;
}

export class JsonlTaskFlowStore implements TaskFlowStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async #readAll(): Promise<TaskRecord[]> {
    try {
      const content = await readFile(this.#filePath, "utf-8");
      return content
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as TaskRecord);
    } catch {
      return [];
    }
  }

  async #writeAll(records: TaskRecord[]): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  }

  async create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const full: TaskRecord = { ...record, createdAt: now, updatedAt: now };
    const all = await this.#readAll();
    all.push(full);
    await this.#writeAll(all);
    return full;
  }

  async update(id: string, updates: Partial<Pick<TaskRecord, "status" | "progressSummary" | "terminalSummary">>): Promise<TaskRecord | undefined> {
    const all = await this.#readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    const updated = { ...all[idx]!, ...updates, updatedAt: new Date().toISOString() };
    all[idx] = updated;
    await this.#writeAll(all);
    return updated;
  }

  async get(id: string): Promise<TaskRecord | undefined> {
    const all = await this.#readAll();
    return all.find((r) => r.id === id);
  }

  async list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]> {
    let records = await this.#readAll();
    if (query?.status !== undefined) records = records.filter((r) => r.status === query.status);
    if (query?.parentId !== undefined) records = records.filter((r) => r.parentId === query.parentId);
    if (query?.limit !== undefined) records = records.slice(-query.limit);
    return records;
  }
}

// Re-export join for consumers that need to build file paths
export { join };

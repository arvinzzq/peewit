/**
 * INPUT: Task definitions, task status updates, parent/child relationships, completed-child announcements.
 * OUTPUT: TaskRecord, TaskStatus, TaskRuntime, PendingAnnouncement types, JsonlTaskFlowStore with push-based announcement drain, task lifecycle management.
 * POS: TaskFlow layer; owns persistent cross-session task graph state and the parent-facing push-completion mailbox.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export const taskflowPackageName = "@vole/taskflow";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

export type TaskRuntime = "subagent" | "background" | "cli" | "cron" | "web";

export type AnnouncementStatus = "succeeded" | "failed" | "timed_out";

export interface PendingAnnouncement {
  taskId: string;
  goal: string;
  status: AnnouncementStatus;
  terminalSummary?: string;
  completedAt: string;
}

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
  pendingAnnouncement?: PendingAnnouncement;  // Phase 12: push-to-parent mailbox; set by child on terminal status, cleared by parent's drain
}

export type TaskUpdate = Partial<Pick<TaskRecord, "status" | "progressSummary" | "terminalSummary" | "pendingAnnouncement">> & {
  /** Set to true to clear pendingAnnouncement (used by parent drain). */
  clearPendingAnnouncement?: boolean;
};

export interface TaskFlowStore {
  create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord>;
  update(id: string, updates: TaskUpdate): Promise<TaskRecord | undefined>;
  get(id: string): Promise<TaskRecord | undefined>;
  list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]>;
  /** Atomically read all pending announcements for one parent's children and clear them. */
  drainPendingForParent(parentId: string): Promise<PendingAnnouncement[]>;
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

  async update(id: string, updates: TaskUpdate): Promise<TaskRecord | undefined> {
    const all = await this.#readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    const { clearPendingAnnouncement, ...fields } = updates;
    const next: TaskRecord = { ...all[idx]!, ...fields, updatedAt: new Date().toISOString() };
    if (clearPendingAnnouncement === true) {
      delete next.pendingAnnouncement;
    }
    all[idx] = next;
    await this.#writeAll(all);
    return next;
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

  async drainPendingForParent(parentId: string): Promise<PendingAnnouncement[]> {
    const all = await this.#readAll();
    const announcements: PendingAnnouncement[] = [];
    const now = new Date().toISOString();
    let mutated = false;
    for (let i = 0; i < all.length; i++) {
      const record = all[i]!;
      if (record.parentId === parentId && record.pendingAnnouncement !== undefined) {
        announcements.push(record.pendingAnnouncement);
        const next: TaskRecord = { ...record, updatedAt: now };
        delete next.pendingAnnouncement;
        all[i] = next;
        mutated = true;
      }
    }
    if (mutated) {
      await this.#writeAll(all);
    }
    return announcements;
  }
}

// Re-export join for consumers that need to build file paths
export { join };

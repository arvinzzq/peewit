/**
 * INPUT: Task definition config, task run records, background approval requests.
 * OUTPUT: TaskDefinition/TaskRunRecord types, JsonlTaskStore, BackgroundApprovalResolver.
 * POS: Background task layer; owns task run persistence and approval policy for unattended execution.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApprovalRequest, ApprovalResolution, ApprovalResolver } from "@arvinclaw/core";

export const schedulerPackageName = "@arvinclaw/scheduler";

// Task definition loaded from task files or CLI arguments
export interface TaskDefinition {
  name: string;
  goal: string;
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

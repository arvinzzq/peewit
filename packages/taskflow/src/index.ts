/**
 * INPUT: Task definitions, task status updates, parent/child relationships, completed-child announcements.
 * OUTPUT: TaskRecord, TaskStatus, TaskRuntime, PendingAnnouncement types, JsonlTaskFlowStore with push-based announcement drain, SqliteTaskFlowStore (with SQLITE_TASKFLOW_SCHEMA_SQL DDL) and migrateJsonlTaskFlowToSqlite migration helper, task lifecycle management.
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

// ----------------------------------------------------------------------------
// SqliteTaskFlowStore — Phase 14 Step 4
// ----------------------------------------------------------------------------

import Database from "better-sqlite3";

/**
 * Schema DDL for the SQLite taskflow store. Exported so the Phase 14b migration
 * helper can initialize a fresh database without going through the store
 * constructor.
 */
export const SQLITE_TASKFLOW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS task_records (
    id TEXT PRIMARY KEY,
    runtime TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    progressSummary TEXT,
    terminalSummary TEXT,
    parentId TEXT,
    sessionId TEXT,
    pendingAnnouncementJson TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS task_records_status_idx ON task_records(status);
  CREATE INDEX IF NOT EXISTS task_records_parent_idx ON task_records(parentId);
  CREATE INDEX IF NOT EXISTS task_records_runtime_idx ON task_records(runtime);
  CREATE INDEX IF NOT EXISTS task_records_created_idx ON task_records(createdAt);

  CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
`;

export interface JsonlTaskFlowMigrationStats {
  taskRecords: number;
}

/**
 * Migrate a JSONL taskflow file into a fresh SQLite database. Idempotent: rows
 * with the same id are skipped via INSERT OR IGNORE.
 */
export async function migrateJsonlTaskFlowToSqlite(
  sourceJsonlPath: string,
  targetDbPath: string,
  options: { dryRun?: boolean } = {}
): Promise<JsonlTaskFlowMigrationStats> {
  const stats: JsonlTaskFlowMigrationStats = { taskRecords: 0 };
  let content: string;
  try {
    content = await readFile(sourceJsonlPath, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") return stats;
    throw error;
  }

  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return stats;

  const db = options.dryRun === true ? undefined : new Database(targetDbPath);
  if (db !== undefined) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(SQLITE_TASKFLOW_SCHEMA_SQL);
  }

  try {
    for (const line of lines) {
      const record = JSON.parse(line) as TaskRecord;
      stats.taskRecords++;
      if (db !== undefined) {
        db.prepare(
          `INSERT OR IGNORE INTO task_records (
            id, runtime, task, status, progressSummary, terminalSummary,
            parentId, sessionId, pendingAnnouncementJson, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          record.id, record.runtime, record.task, record.status,
          record.progressSummary ?? null, record.terminalSummary ?? null,
          record.parentId ?? null, record.sessionId ?? null,
          record.pendingAnnouncement === undefined ? null : JSON.stringify(record.pendingAnnouncement),
          record.createdAt, record.updatedAt
        );
      }
    }
  } finally {
    db?.close();
  }
  return stats;
}

export interface SqliteTaskFlowStoreOptions {
  databasePath: string;
}

/**
 * SqliteTaskFlowStore is a drop-in replacement for JsonlTaskFlowStore backed by
 * better-sqlite3. The `pendingAnnouncement` mailbox column is updated and
 * cleared with single SQL statements instead of a full file rewrite.
 *
 * Schema:
 *   task_records(id PK, runtime, task, status, progressSummary?, terminalSummary?,
 *                parentId?, sessionId?, pendingAnnouncementJson?,
 *                createdAt, updatedAt)
 *   indexes on status, parentId, runtime, createdAt
 */
export class SqliteTaskFlowStore implements TaskFlowStore {
  readonly #db: Database.Database;

  constructor(options: SqliteTaskFlowStoreOptions) {
    this.#db = new Database(options.databasePath);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = NORMAL");
    this.#initSchema();
  }

  close(): void {
    this.#db.close();
  }

  #initSchema(): void {
    this.#db.exec(SQLITE_TASKFLOW_SCHEMA_SQL);
    const row = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version?: number } | undefined;
    if (row === undefined) {
      this.#db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
    }
  }

  async create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const full: TaskRecord = { ...record, createdAt: now, updatedAt: now };
    this.#db
      .prepare(`INSERT INTO task_records (
        id, runtime, task, status, progressSummary, terminalSummary,
        parentId, sessionId, pendingAnnouncementJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        full.id, full.runtime, full.task, full.status,
        full.progressSummary ?? null, full.terminalSummary ?? null,
        full.parentId ?? null, full.sessionId ?? null,
        full.pendingAnnouncement === undefined ? null : JSON.stringify(full.pendingAnnouncement),
        full.createdAt, full.updatedAt
      );
    return full;
  }

  async update(id: string, updates: TaskUpdate): Promise<TaskRecord | undefined> {
    const existing = await this.get(id);
    if (existing === undefined) return undefined;
    const { clearPendingAnnouncement, ...fields } = updates;
    const next: TaskRecord = { ...existing, ...fields, updatedAt: new Date().toISOString() };
    if (clearPendingAnnouncement === true) {
      delete next.pendingAnnouncement;
    }
    this.#db
      .prepare(`UPDATE task_records SET
        status = ?, progressSummary = ?, terminalSummary = ?,
        pendingAnnouncementJson = ?, updatedAt = ?
        WHERE id = ?`)
      .run(
        next.status,
        next.progressSummary ?? null,
        next.terminalSummary ?? null,
        next.pendingAnnouncement === undefined ? null : JSON.stringify(next.pendingAnnouncement),
        next.updatedAt,
        id
      );
    return next;
  }

  async get(id: string): Promise<TaskRecord | undefined> {
    const row = this.#db
      .prepare("SELECT * FROM task_records WHERE id = ?")
      .get(id) as TaskRecordRow | undefined;
    return row === undefined ? undefined : rowToTaskRecord(row);
  }

  async list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query?.status !== undefined) {
      where.push("status = ?");
      params.push(query.status);
    }
    if (query?.parentId !== undefined) {
      where.push("parentId = ?");
      params.push(query.parentId);
    }
    const whereClause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
    const limitClause = query?.limit === undefined ? "" : ` LIMIT ${query.limit}`;
    const orderClause = " ORDER BY createdAt ASC";
    let sql = `SELECT * FROM task_records${whereClause}${orderClause}`;
    if (query?.limit !== undefined) {
      sql = `SELECT * FROM (SELECT * FROM task_records${whereClause} ORDER BY createdAt DESC${limitClause}) ORDER BY createdAt ASC`;
    }
    const rows = this.#db.prepare(sql).all(...params) as TaskRecordRow[];
    return rows.map(rowToTaskRecord);
  }

  async drainPendingForParent(parentId: string): Promise<PendingAnnouncement[]> {
    const rows = this.#db
      .prepare("SELECT id, pendingAnnouncementJson FROM task_records WHERE parentId = ? AND pendingAnnouncementJson IS NOT NULL")
      .all(parentId) as Array<{ id: string; pendingAnnouncementJson: string }>;
    if (rows.length === 0) return [];
    const announcements: PendingAnnouncement[] = [];
    const now = new Date().toISOString();
    this.#db.transaction(() => {
      const clear = this.#db.prepare("UPDATE task_records SET pendingAnnouncementJson = NULL, updatedAt = ? WHERE id = ?");
      for (const row of rows) {
        try {
          announcements.push(JSON.parse(row.pendingAnnouncementJson) as PendingAnnouncement);
        } catch {
          // Skip corrupt entry but still clear it.
        }
        clear.run(now, row.id);
      }
    })();
    return announcements;
  }
}

interface TaskRecordRow {
  id: string;
  runtime: string;
  task: string;
  status: string;
  progressSummary: string | null;
  terminalSummary: string | null;
  parentId: string | null;
  sessionId: string | null;
  pendingAnnouncementJson: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToTaskRecord(row: TaskRecordRow): TaskRecord {
  return {
    id: row.id,
    runtime: row.runtime as TaskRuntime,
    task: row.task,
    status: row.status as TaskStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.progressSummary !== null ? { progressSummary: row.progressSummary } : {}),
    ...(row.terminalSummary !== null ? { terminalSummary: row.terminalSummary } : {}),
    ...(row.parentId !== null ? { parentId: row.parentId } : {}),
    ...(row.sessionId !== null ? { sessionId: row.sessionId } : {}),
    ...(row.pendingAnnouncementJson !== null
      ? { pendingAnnouncement: JSON.parse(row.pendingAnnouncementJson) as PendingAnnouncement }
      : {})
  };
}

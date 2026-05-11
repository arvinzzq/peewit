/**
 * INPUT: Session creation requests, conversation messages (including tool_use and tool_result), compaction boundaries, runtime trace events, persistence directories, injectable ID/time providers, and cross-process file lock options.
 * OUTPUT: Session records, message/trace records, compact_boundary records, session store contracts, in-memory storage, JSONL session storage with cross-process file lock, and acquireSessionFileLock helper.
 * POS: Session storage layer; owns replayable short-term conversation state with compaction support and cross-process write serialization. The in-process lane (in @vole/lanes) serializes within one Node process; this file lock serializes across processes targeting the same session JSONL.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const sessionsPackageName = "@vole/sessions";

export type SessionMessageRole = "user" | "assistant" | "tool" | "system";

export interface SessionRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  createdAt: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolCallId?: string;
}

export interface SessionTraceEventRecord<TEvent = unknown> {
  sessionId: string;
  event: TEvent;
  createdAt: string;
}

export interface CreateSessionInput {
  title?: string;
}

export interface AppendSessionMessageInput {
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolCallId?: string;
}

export interface AppendCompactBoundaryInput {
  sessionId: string;
  summary: string;
  messagesBefore: number;
  messagesAfter: number;
}

export interface AppendSessionTraceEventInput<TEvent = unknown> {
  sessionId: string;
  event: TEvent;
}

export interface ListSessionMessagesQuery {
  limit?: number;
}

export interface ListSessionTraceEventsQuery {
  limit?: number;
}

export interface ListSessionsQuery {
  limit?: number;
}

export interface SessionStore {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  listSessions(query?: ListSessionsQuery): Promise<SessionRecord[]>;
  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>;
  listMessages(sessionId: string, query?: ListSessionMessagesQuery): Promise<SessionMessageRecord[]>;
  appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>>;
  listTraceEvents<TEvent = unknown>(sessionId: string, query?: ListSessionTraceEventsQuery): Promise<SessionTraceEventRecord<TEvent>[]>;
  appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void>;
}

export interface InMemorySessionStoreDependencies {
  createSessionId?: () => string;
  createMessageId?: () => string;
  now?: () => string;
}

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #messages = new Map<string, SessionMessageRecord[]>();
  readonly #traceEvents = new Map<string, Array<SessionTraceEventRecord<unknown>>>();
  readonly #createSessionId: () => string;
  readonly #createMessageId: () => string;
  readonly #now: () => string;

  constructor(dependencies: InMemorySessionStoreDependencies = {}) {
    this.#createSessionId = dependencies.createSessionId ?? randomId("sess");
    this.#createMessageId = dependencies.createMessageId ?? randomId("msg");
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async createSession(input: CreateSessionInput = {}): Promise<SessionRecord> {
    const timestamp = this.#now();
    const session: SessionRecord = {
      id: this.#createSessionId(),
      ...(input.title === undefined ? {} : { title: input.title }),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.#sessions.set(session.id, session);
    this.#messages.set(session.id, []);
    this.#traceEvents.set(session.id, []);

    return { ...session };
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.#sessions.get(sessionId);

    return session === undefined ? undefined : { ...session };
  }

  async listSessions(query: ListSessionsQuery = {}): Promise<SessionRecord[]> {
    const sessions = [...this.#sessions.values()].sort(compareSessionsByRecentUpdate);
    const selectedSessions = query.limit === undefined ? sessions : sessions.slice(0, query.limit);

    return selectedSessions.map((session) => ({ ...session }));
  }

  async appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord> {
    const session = this.#sessions.get(input.sessionId);

    if (session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    const timestamp = this.#now();
    const message: SessionMessageRecord = {
      id: this.#createMessageId(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: timestamp,
      ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
      ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {})
    };
    const messages = this.#messages.get(input.sessionId) ?? [];

    messages.push(message);
    this.#messages.set(input.sessionId, messages);
    this.#sessions.set(input.sessionId, {
      ...session,
      updatedAt: timestamp
    });

    return { ...message };
  }

  async listMessages(sessionId: string, query: ListSessionMessagesQuery = {}): Promise<SessionMessageRecord[]> {
    const messages = this.#messages.get(sessionId) ?? [];
    const selectedMessages = query.limit === undefined ? messages : messages.slice(-query.limit);

    return selectedMessages.map((message) => ({ ...message }));
  }

  async appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void> {
    const session = this.#sessions.get(input.sessionId);

    if (session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    // Reset messages to only the summary (if provided)
    const messages: SessionMessageRecord[] = [];
    if (input.summary) {
      const timestamp = this.#now();
      messages.push({
        id: this.#createMessageId(),
        sessionId: input.sessionId,
        role: "system",
        content: input.summary,
        createdAt: timestamp
      });
      this.#sessions.set(input.sessionId, {
        ...session,
        updatedAt: timestamp
      });
    }
    this.#messages.set(input.sessionId, messages);
  }

  async appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>> {
    const session = this.#sessions.get(input.sessionId);

    if (session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    const timestamp = this.#now();
    const traceEvent: SessionTraceEventRecord<TEvent> = {
      sessionId: input.sessionId,
      event: input.event,
      createdAt: timestamp
    };
    const traceEvents = this.#traceEvents.get(input.sessionId) ?? [];

    traceEvents.push(traceEvent);
    this.#traceEvents.set(input.sessionId, traceEvents);
    this.#sessions.set(input.sessionId, {
      ...session,
      updatedAt: timestamp
    });

    return cloneTraceEventRecord(traceEvent);
  }

  async listTraceEvents<TEvent = unknown>(
    sessionId: string,
    query: ListSessionTraceEventsQuery = {}
  ): Promise<SessionTraceEventRecord<TEvent>[]> {
    const traceEvents = this.#traceEvents.get(sessionId) ?? [];
    const selectedTraceEvents = query.limit === undefined ? traceEvents : traceEvents.slice(-query.limit);

    return selectedTraceEvents.map((traceEvent) => cloneTraceEventRecord(traceEvent as SessionTraceEventRecord<TEvent>));
  }
}

export interface JsonlSessionStoreDependencies extends InMemorySessionStoreDependencies {
  directory: string;
  /** Optional cross-process file lock configuration. Defaults are applied when omitted. Pass `{ enabled: false }` to disable for tests. */
  fileLock?: JsonlFileLockOptions;
}

export interface JsonlFileLockOptions {
  enabled?: boolean;
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
  staleAfterMs?: number;
  pid?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

type JsonlSessionRecord =
  | {
      type: "session";
      session: SessionRecord;
    }
  | {
      type: "message";
      message: SessionMessageRecord;
    }
  | {
      type: "trace";
      traceEvent: SessionTraceEventRecord;
    }
  | {
      type: "compact_boundary";
      summary: string;
      messagesBefore: number;
      messagesAfter: number;
      createdAt: string;
    };

export class JsonlSessionStore implements SessionStore {
  readonly #directory: string;
  readonly #createSessionId: () => string;
  readonly #createMessageId: () => string;
  readonly #now: () => string;
  readonly #fileLock: Required<Omit<JsonlFileLockOptions, "pid" | "now" | "isProcessAlive">> & Pick<JsonlFileLockOptions, "pid" | "now" | "isProcessAlive">;

  constructor(dependencies: JsonlSessionStoreDependencies) {
    this.#directory = dependencies.directory;
    this.#createSessionId = dependencies.createSessionId ?? randomId("sess");
    this.#createMessageId = dependencies.createMessageId ?? randomId("msg");
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    const fl = dependencies.fileLock ?? {};
    this.#fileLock = {
      enabled: fl.enabled ?? true,
      acquireTimeoutMs: fl.acquireTimeoutMs ?? DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS,
      retryIntervalMs: fl.retryIntervalMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS,
      staleAfterMs: fl.staleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS,
      ...(fl.pid !== undefined ? { pid: fl.pid } : {}),
      ...(fl.now !== undefined ? { now: fl.now } : {}),
      ...(fl.isProcessAlive !== undefined ? { isProcessAlive: fl.isProcessAlive } : {})
    };
  }

  async createSession(input: CreateSessionInput = {}): Promise<SessionRecord> {
    const timestamp = this.#now();
    const session: SessionRecord = {
      id: this.#createSessionId(),
      ...(input.title === undefined ? {} : { title: input.title }),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.#append(session.id, {
      type: "session",
      session
    });

    return { ...session };
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const replay = await this.#replay(sessionId);

    return replay.session === undefined ? undefined : { ...replay.session };
  }

  async listSessions(query: ListSessionsQuery = {}): Promise<SessionRecord[]> {
    const sessionIds = await this.#sessionIds();
    const sessions: SessionRecord[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);

      if (session !== undefined) {
        sessions.push(session);
      }
    }

    const sortedSessions = sessions.sort(compareSessionsByRecentUpdate);
    const selectedSessions = query.limit === undefined ? sortedSessions : sortedSessions.slice(0, query.limit);

    return selectedSessions.map((session) => ({ ...session }));
  }

  async appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord> {
    const replay = await this.#replay(input.sessionId);

    if (replay.session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    const timestamp = this.#now();
    const message: SessionMessageRecord = {
      id: this.#createMessageId(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: timestamp,
      ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
      ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {})
    };

    // JSONL records are append-only so a session file can be replayed in order
    // and later extended with trace/tool records without rewriting history.
    await this.#append(input.sessionId, {
      type: "message",
      message
    });

    return { ...message };
  }

  async listMessages(sessionId: string, query: ListSessionMessagesQuery = {}): Promise<SessionMessageRecord[]> {
    const replay = await this.#replay(sessionId);
    const selectedMessages = query.limit === undefined ? replay.messages : replay.messages.slice(-query.limit);

    return selectedMessages.map((message) => ({ ...message }));
  }

  async appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>> {
    const replay = await this.#replay(input.sessionId);

    if (replay.session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    const traceEvent: SessionTraceEventRecord<TEvent> = {
      sessionId: input.sessionId,
      event: input.event,
      createdAt: this.#now()
    };

    await this.#append(input.sessionId, {
      type: "trace",
      traceEvent
    });

    return cloneTraceEventRecord(traceEvent);
  }

  async listTraceEvents<TEvent = unknown>(
    sessionId: string,
    query: ListSessionTraceEventsQuery = {}
  ): Promise<SessionTraceEventRecord<TEvent>[]> {
    const replay = await this.#replay(sessionId);
    const selectedTraceEvents = query.limit === undefined ? replay.traceEvents : replay.traceEvents.slice(-query.limit);

    return selectedTraceEvents.map((traceEvent) => cloneTraceEventRecord(traceEvent as SessionTraceEventRecord<TEvent>));
  }

  async appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void> {
    const replay = await this.#replay(input.sessionId);

    if (replay.session === undefined) {
      throw new Error(`Unknown session "${input.sessionId}".`);
    }

    const timestamp = this.#now();
    await this.#append(input.sessionId, {
      type: "compact_boundary",
      summary: input.summary,
      messagesBefore: input.messagesBefore,
      messagesAfter: input.messagesAfter,
      createdAt: timestamp
    });
  }

  async #append(sessionId: string, record: JsonlSessionRecord): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    if (this.#fileLock.enabled) {
      const lock = await acquireSessionFileLock(this.#lockPath(sessionId), this.#fileLock);
      try {
        await writeFile(this.#filePath(sessionId), `${JSON.stringify(record)}\n`, { flag: "a" });
      } finally {
        await lock.release();
      }
    } else {
      await writeFile(this.#filePath(sessionId), `${JSON.stringify(record)}\n`, { flag: "a" });
    }
  }

  #lockPath(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return join(this.#directory, `${sessionId}.lock`);
  }

  async #replay(sessionId: string): Promise<{
    session?: SessionRecord;
    messages: SessionMessageRecord[];
    traceEvents: Array<SessionTraceEventRecord<unknown>>;
  }> {
    let content = "";

    try {
      content = await readFile(this.#filePath(sessionId), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { messages: [], traceEvents: [] };
      }

      throw error;
    }

    let messages: SessionMessageRecord[] = [];
    const traceEvents: Array<SessionTraceEventRecord<unknown>> = [];
    let session: SessionRecord | undefined;

    for (const line of content.split("\n")) {
      if (line.trim() === "") {
        continue;
      }

      const record = JSON.parse(line) as JsonlSessionRecord;

      if (record.type === "session") {
        session = record.session;
      } else if (record.type === "compact_boundary") {
        // Discard all previous messages, start fresh from the summary
        messages = [];
        if (record.summary) {
          messages.push({
            id: `cmpct_${record.createdAt}`,
            sessionId: session?.id ?? "",
            role: "system" as const,
            content: record.summary,
            createdAt: record.createdAt
          });
        }
        if (session && record.createdAt > session.updatedAt) {
          session = {
            ...session,
            updatedAt: record.createdAt
          };
        }
      } else if (record.type === "message") {
        messages.push(record.message);
        if (session && record.message.createdAt > session.updatedAt) {
          session = {
            ...session,
            updatedAt: record.message.createdAt
          };
        }
      } else {
        traceEvents.push(record.traceEvent);
        if (session && record.traceEvent.createdAt > session.updatedAt) {
          session = {
            ...session,
            updatedAt: record.traceEvent.createdAt
          };
        }
      }
    }

    return {
      ...(session === undefined ? {} : { session }),
      messages,
      traceEvents
    };
  }

  #filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);

    return join(this.#directory, `${sessionId}.jsonl`);
  }

  async #sessionIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.#directory);

      return entries
        .filter((entry) => entry.endsWith(".jsonl"))
        .map((entry) => entry.slice(0, -".jsonl".length))
        .filter((sessionId) => /^[A-Za-z0-9_-]+$/.test(sessionId));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Unsafe session id "${sessionId}".`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function compareSessionsByRecentUpdate(left: SessionRecord, right: SessionRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function cloneTraceEventRecord<TEvent>(traceEvent: SessionTraceEventRecord<TEvent>): SessionTraceEventRecord<TEvent> {
  return {
    ...traceEvent,
    event: structuredClone(traceEvent.event)
  };
}

function randomId(prefix: string): () => string {
  return () => `${prefix}_${crypto.randomUUID()}`;
}

// ----------------------------------------------------------------------------
// Cross-process session file lock
// ----------------------------------------------------------------------------

export const DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
export const DEFAULT_LOCK_RETRY_INTERVAL_MS = 50;
export const DEFAULT_LOCK_STALE_AFTER_MS = 60_000;

export interface AcquireSessionFileLockOptions {
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
  staleAfterMs?: number;
  pid?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface SessionFileLock {
  readonly lockPath: string;
  release(): Promise<void>;
}

interface LockFileBody {
  pid: number;
  startedAt: number;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false;
    }
    // EPERM means the process exists but we lack permission to signal it — count as alive.
    return true;
  }
}

/**
 * Acquire an exclusive cross-process lock on the given `.lock` sidecar path.
 *
 * Uses `open` with `wx` flag (atomic create-if-not-exists). When the lock is
 * already held, polls every `retryIntervalMs` until the holder releases or the
 * lock is determined to be stale (process dead or older than `staleAfterMs`).
 * Throws after `acquireTimeoutMs` total elapsed.
 */
export async function acquireSessionFileLock(
  lockPath: string,
  options: AcquireSessionFileLockOptions = {}
): Promise<SessionFileLock> {
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS;
  const pid = options.pid ?? process.pid;
  const nowFn = options.now ?? (() => Date.now());
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;

  const startTime = nowFn();
  const body: LockFileBody = { pid, startedAt: nowFn() };
  const serialized = JSON.stringify(body);

  let released = false;
  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    try {
      await unlink(lockPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  };

  while (true) {
    try {
      await writeFile(lockPath, serialized, { flag: "wx" });
      return { lockPath, release };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
    }

    // Lock exists: inspect it. Reclaim if stale.
    let existing: LockFileBody | undefined;
    try {
      const text = await readFile(lockPath, "utf8");
      existing = JSON.parse(text) as LockFileBody;
    } catch (readError) {
      if (!isNodeError(readError) || (readError.code !== "ENOENT" && !(readError instanceof SyntaxError))) {
        // Corrupt or unreadable — treat as stale and try to remove.
        existing = undefined;
      }
    }

    let stale = false;
    if (existing === undefined) {
      stale = true;
    } else {
      const age = nowFn() - existing.startedAt;
      if (age > staleAfterMs) {
        stale = true;
      } else if (typeof existing.pid === "number" && !isProcessAlive(existing.pid)) {
        stale = true;
      }
    }

    if (stale) {
      try {
        await unlink(lockPath);
      } catch (unlinkError) {
        if (!isNodeError(unlinkError) || unlinkError.code !== "ENOENT") {
          throw unlinkError;
        }
      }
      // Retry creation immediately after clearing stale lock.
      continue;
    }

    if (nowFn() - startTime > acquireTimeoutMs) {
      throw new Error(
        `Timed out acquiring session file lock at ${lockPath} after ${acquireTimeoutMs}ms (held by pid ${existing?.pid ?? "?"}).`
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, retryIntervalMs));
  }
}

// ----------------------------------------------------------------------------
// SqliteSessionStore — Phase 14 Step 3
// ----------------------------------------------------------------------------

import Database from "better-sqlite3";

export interface SqliteSessionStoreDependencies extends InMemorySessionStoreDependencies {
  /** Absolute path to the SQLite database file. */
  databasePath: string;
}

/**
 * SqliteSessionStore is a drop-in replacement for `JsonlSessionStore` backed by
 * better-sqlite3 with WAL journaling. It implements the same `SessionStore`
 * contract — consumers do not branch on backend.
 *
 * Schema:
 *   sessions(id PK, title?, createdAt, updatedAt)
 *   messages(id PK, sessionId FK, role, content?, toolCallsJson?, toolCallId?, createdAt)
 *     index: (sessionId, createdAt)
 *   trace_events(id INTEGER PK, sessionId FK, eventJson, createdAt)
 *     index: (sessionId, createdAt)
 *   compact_boundaries(id INTEGER PK, sessionId FK, summary, messagesBefore, messagesAfter, createdAt)
 *
 * Like the JSONL store, listMessages applies the latest compact_boundary's
 * effect: after a boundary, only the summary (as a synthetic system message)
 * plus messages newer than the boundary are returned.
 */
export class SqliteSessionStore implements SessionStore {
  readonly #db: Database.Database;
  readonly #createSessionId: () => string;
  readonly #createMessageId: () => string;
  readonly #now: () => string;

  constructor(dependencies: SqliteSessionStoreDependencies) {
    this.#db = new Database(dependencies.databasePath);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = NORMAL");
    this.#db.pragma("foreign_keys = ON");
    this.#initSchema();
    this.#createSessionId = dependencies.createSessionId ?? randomId("sess");
    this.#createMessageId = dependencies.createMessageId ?? randomId("msg");
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  /** Close the underlying database. Call this at process shutdown for clean WAL checkpointing. */
  close(): void {
    this.#db.close();
  }

  #initSchema(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updatedAt DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        toolCallsJson TEXT,
        toolCallId TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(sessionId, createdAt);

      CREATE TABLE IF NOT EXISTS trace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        eventJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trace_events_session_created_idx ON trace_events(sessionId, createdAt);

      CREATE TABLE IF NOT EXISTS compact_boundaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        messagesBefore INTEGER NOT NULL,
        messagesAfter INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS compact_boundaries_session_created_idx ON compact_boundaries(sessionId, createdAt);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
    const row = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version?: number } | undefined;
    if (row === undefined) {
      this.#db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
    }
  }

  async createSession(input: CreateSessionInput = {}): Promise<SessionRecord> {
    const timestamp = this.#now();
    const session: SessionRecord = {
      id: this.#createSessionId(),
      ...(input.title === undefined ? {} : { title: input.title }),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.#db
      .prepare("INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)")
      .run(session.id, session.title ?? null, session.createdAt, session.updatedAt);
    return { ...session };
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const row = this.#db
      .prepare("SELECT id, title, createdAt, updatedAt FROM sessions WHERE id = ?")
      .get(sessionId) as { id: string; title: string | null; createdAt: string; updatedAt: string } | undefined;
    if (row === undefined) return undefined;
    return rowToSessionRecord(row);
  }

  async listSessions(query: ListSessionsQuery = {}): Promise<SessionRecord[]> {
    const limit = query.limit ?? -1;
    const stmt = limit < 0
      ? this.#db.prepare("SELECT id, title, createdAt, updatedAt FROM sessions ORDER BY updatedAt DESC")
      : this.#db.prepare("SELECT id, title, createdAt, updatedAt FROM sessions ORDER BY updatedAt DESC LIMIT ?");
    const rows = (limit < 0 ? stmt.all() : stmt.all(limit)) as Array<{
      id: string;
      title: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    return rows.map(rowToSessionRecord);
  }

  async appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord> {
    const session = await this.getSession(input.sessionId);
    if (session === undefined) throw new Error(`Unknown session "${input.sessionId}".`);
    const timestamp = this.#now();
    const message: SessionMessageRecord = {
      id: this.#createMessageId(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: timestamp,
      ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
      ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {})
    };
    this.#db.transaction(() => {
      this.#db
        .prepare("INSERT INTO messages (id, sessionId, role, content, toolCallsJson, toolCallId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.toolCalls === undefined ? null : JSON.stringify(message.toolCalls),
          message.toolCallId ?? null,
          message.createdAt
        );
      this.#db.prepare("UPDATE sessions SET updatedAt = ? WHERE id = ?").run(timestamp, input.sessionId);
    })();
    return { ...message };
  }

  async listMessages(sessionId: string, query: ListSessionMessagesQuery = {}): Promise<SessionMessageRecord[]> {
    // Find the latest compact boundary for this session, if any.
    const boundary = this.#db
      .prepare("SELECT summary, createdAt FROM compact_boundaries WHERE sessionId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(sessionId) as { summary: string; createdAt: string } | undefined;

    const messageRows = (this.#db
      .prepare(
        boundary === undefined
          ? "SELECT id, sessionId, role, content, toolCallsJson, toolCallId, createdAt FROM messages WHERE sessionId = ? ORDER BY createdAt ASC"
          : "SELECT id, sessionId, role, content, toolCallsJson, toolCallId, createdAt FROM messages WHERE sessionId = ? AND createdAt > ? ORDER BY createdAt ASC"
      )
      .all(boundary === undefined ? sessionId : [sessionId, boundary.createdAt])) as Array<{
        id: string;
        sessionId: string;
        role: SessionMessageRole;
        content: string | null;
        toolCallsJson: string | null;
        toolCallId: string | null;
        createdAt: string;
      }>;

    const messages: SessionMessageRecord[] = [];
    if (boundary !== undefined && boundary.summary.length > 0) {
      messages.push({
        id: `cmpct_${boundary.createdAt}`,
        sessionId,
        role: "system",
        content: boundary.summary,
        createdAt: boundary.createdAt
      });
    }
    for (const row of messageRows) {
      messages.push(rowToMessageRecord(row));
    }
    return query.limit === undefined ? messages : messages.slice(-query.limit);
  }

  async appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void> {
    const session = await this.getSession(input.sessionId);
    if (session === undefined) throw new Error(`Unknown session "${input.sessionId}".`);
    const timestamp = this.#now();
    this.#db.transaction(() => {
      this.#db
        .prepare("INSERT INTO compact_boundaries (sessionId, summary, messagesBefore, messagesAfter, createdAt) VALUES (?, ?, ?, ?, ?)")
        .run(input.sessionId, input.summary, input.messagesBefore, input.messagesAfter, timestamp);
      this.#db.prepare("UPDATE sessions SET updatedAt = ? WHERE id = ?").run(timestamp, input.sessionId);
    })();
  }

  async appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>> {
    const session = await this.getSession(input.sessionId);
    if (session === undefined) throw new Error(`Unknown session "${input.sessionId}".`);
    const timestamp = this.#now();
    this.#db.transaction(() => {
      this.#db
        .prepare("INSERT INTO trace_events (sessionId, eventJson, createdAt) VALUES (?, ?, ?)")
        .run(input.sessionId, JSON.stringify(input.event), timestamp);
      this.#db.prepare("UPDATE sessions SET updatedAt = ? WHERE id = ?").run(timestamp, input.sessionId);
    })();
    return {
      sessionId: input.sessionId,
      event: structuredClone(input.event),
      createdAt: timestamp
    };
  }

  async listTraceEvents<TEvent = unknown>(
    sessionId: string,
    query: ListSessionTraceEventsQuery = {}
  ): Promise<SessionTraceEventRecord<TEvent>[]> {
    const limit = query.limit ?? -1;
    const stmt = limit < 0
      ? this.#db.prepare("SELECT eventJson, createdAt FROM trace_events WHERE sessionId = ? ORDER BY createdAt ASC")
      : this.#db.prepare("SELECT eventJson, createdAt FROM trace_events WHERE sessionId = ? ORDER BY createdAt ASC LIMIT ?");
    const rows = (limit < 0
      ? stmt.all(sessionId)
      : stmt.all(sessionId, limit)) as Array<{ eventJson: string; createdAt: string }>;
    return rows.map((row) => ({
      sessionId,
      event: JSON.parse(row.eventJson) as TEvent,
      createdAt: row.createdAt
    }));
  }
}

function rowToSessionRecord(row: { id: string; title: string | null; createdAt: string; updatedAt: string }): SessionRecord {
  return {
    id: row.id,
    ...(row.title !== null ? { title: row.title } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function rowToMessageRecord(row: {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  toolCallsJson: string | null;
  toolCallId: string | null;
  createdAt: string;
}): SessionMessageRecord {
  const toolCalls = row.toolCallsJson === null
    ? undefined
    : (JSON.parse(row.toolCallsJson) as Array<{ id: string; name: string; input: unknown }>);
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(row.toolCallId !== null ? { toolCallId: row.toolCallId } : {})
  };
}

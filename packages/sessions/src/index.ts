/**
 * INPUT: Session creation requests, conversation messages, runtime trace events, persistence directories, and injectable ID/time providers.
 * OUTPUT: Session records, message/trace records, session store contracts, in-memory storage, and JSONL session storage.
 * POS: Session storage layer; owns replayable short-term conversation state.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const sessionsPackageName = "@peewit/sessions";

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
  content: string;
  createdAt: string;
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
  content: string;
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
      createdAt: timestamp
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
    };

export class JsonlSessionStore implements SessionStore {
  readonly #directory: string;
  readonly #createSessionId: () => string;
  readonly #createMessageId: () => string;
  readonly #now: () => string;

  constructor(dependencies: JsonlSessionStoreDependencies) {
    this.#directory = dependencies.directory;
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
      createdAt: timestamp
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

  async #append(sessionId: string, record: JsonlSessionRecord): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await writeFile(this.#filePath(sessionId), `${JSON.stringify(record)}\n`, { flag: "a" });
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

    const messages: SessionMessageRecord[] = [];
    const traceEvents: Array<SessionTraceEventRecord<unknown>> = [];
    let session: SessionRecord | undefined;

    for (const line of content.split("\n")) {
      if (line.trim() === "") {
        continue;
      }

      const record = JSON.parse(line) as JsonlSessionRecord;

      if (record.type === "session") {
        session = record.session;
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

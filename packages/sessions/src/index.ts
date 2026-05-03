/**
 * INPUT: Session creation requests, conversation messages, persistence directories, and injectable ID/time providers.
 * OUTPUT: Session records, message records, session store contracts, in-memory storage, and JSONL session storage.
 * POS: Session storage layer; owns replayable short-term conversation state.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const sessionsPackageName = "@arvinclaw/sessions";

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

export interface CreateSessionInput {
  title?: string;
}

export interface AppendSessionMessageInput {
  sessionId: string;
  role: SessionMessageRole;
  content: string;
}

export interface ListSessionMessagesQuery {
  limit?: number;
}

export interface SessionStore {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>;
  listMessages(sessionId: string, query?: ListSessionMessagesQuery): Promise<SessionMessageRecord[]>;
}

export interface InMemorySessionStoreDependencies {
  createSessionId?: () => string;
  createMessageId?: () => string;
  now?: () => string;
}

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #messages = new Map<string, SessionMessageRecord[]>();
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

    return { ...session };
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.#sessions.get(sessionId);

    return session === undefined ? undefined : { ...session };
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

  async #append(sessionId: string, record: JsonlSessionRecord): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await writeFile(this.#filePath(sessionId), `${JSON.stringify(record)}\n`, { flag: "a" });
  }

  async #replay(sessionId: string): Promise<{ session?: SessionRecord; messages: SessionMessageRecord[] }> {
    let content = "";

    try {
      content = await readFile(this.#filePath(sessionId), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { messages: [] };
      }

      throw error;
    }

    const messages: SessionMessageRecord[] = [];
    let session: SessionRecord | undefined;

    for (const line of content.split("\n")) {
      if (line.trim() === "") {
        continue;
      }

      const record = JSON.parse(line) as JsonlSessionRecord;

      if (record.type === "session") {
        session = record.session;
      } else {
        messages.push(record.message);
        if (session && record.message.createdAt > session.updatedAt) {
          session = {
            ...session,
            updatedAt: record.message.createdAt
          };
        }
      }
    }

    return {
      ...(session === undefined ? {} : { session }),
      messages
    };
  }

  #filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);

    return join(this.#directory, `${sessionId}.jsonl`);
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

function randomId(prefix: string): () => string {
  return () => `${prefix}_${crypto.randomUUID()}`;
}

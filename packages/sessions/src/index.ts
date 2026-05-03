/**
 * INPUT: Session creation requests, conversation messages, and injectable ID/time providers.
 * OUTPUT: Session records, message records, session store contracts, and in-memory session storage.
 * POS: Session storage layer; owns replayable short-term conversation state.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
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

function randomId(prefix: string): () => string {
  return () => `${prefix}_${crypto.randomUUID()}`;
}

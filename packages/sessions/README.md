# Sessions Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@peewit/sessions` owns the **session persistence boundary**: it stores conversation messages and runtime trace events with session scope. It keeps persistence concerns completely separate from runtime orchestration, permission logic, and UI rendering.

```
CLI / Web adapter
    │  stores messages and trace events
    ▼
SessionStore (interface)
    ├─ InMemorySessionStore   (in-process, for testing and ephemeral use)
    └─ JsonlSessionStore      (JSONL files, for durable persistence)
```

## Core Concepts

### Session, Message, TraceEvent

A `SessionRecord` is the top-level container:

```typescript
interface SessionRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;  // bumped on each message or trace event append
}
```

A `SessionMessageRecord` is one turn of conversation:

```typescript
interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: string;
}
```

A `SessionTraceEventRecord<TEvent>` is a generic wrapper around any event type (typically `RuntimeEvent` from `@peewit/core`):

```typescript
interface SessionTraceEventRecord<TEvent = unknown> {
  sessionId: string;
  event: TEvent;
  createdAt: string;
}
```

### SessionStore Interface

All store operations are async to support both in-memory and file-based implementations behind the same interface:

```typescript
interface SessionStore {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  listSessions(query?: { limit?: number }): Promise<SessionRecord[]>;
  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>;
  listMessages(sessionId: string, query?: { limit?: number }): Promise<SessionMessageRecord[]>;
  appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>>;
  listTraceEvents<TEvent>(sessionId: string, query?: { limit?: number }): Promise<SessionTraceEventRecord<TEvent>[]>;
}
```

`listSessions` returns sessions sorted by `updatedAt` descending (most recently active first). `listMessages` and `listTraceEvents` support `limit` which slices from the tail (most recent).

## Implementation Principles

### InMemorySessionStore

Uses three `Map` objects keyed by session ID:
- `#sessions: Map<string, SessionRecord>`
- `#messages: Map<string, SessionMessageRecord[]>`
- `#traceEvents: Map<string, SessionTraceEventRecord[]>`

All returned records are shallow-copied (spread operator), and trace events are `structuredClone`d to prevent mutation of stored state. IDs are generated with `crypto.randomUUID()` prefixed by type (`sess_`, `msg_`). All timestamps and ID generators are injectable for testing determinism.

### JsonlSessionStore — JSONL Format

Each session is stored in a single JSONL file at `{directory}/{sessionId}.jsonl`. Every record is one JSON line with a `type` discriminator:

```jsonl
{"type":"session","session":{"id":"sess_abc","createdAt":"…","updatedAt":"…"}}
{"type":"message","message":{"id":"msg_xyz","role":"user","content":"Hello","createdAt":"…"}}
{"type":"message","message":{"id":"msg_qrs","role":"assistant","content":"Hi!","createdAt":"…"}}
{"type":"trace","traceEvent":{"sessionId":"sess_abc","event":{"type":"run_completed",…},"createdAt":"…"}}
```

This format has three important properties:
1. **Append-only writes**: Every `appendMessage` and `appendTraceEvent` call appends exactly one line. No lines are ever modified or deleted.
2. **Replayable**: The entire session state can be reconstructed by reading lines in order — the `#replay()` method does this on every read operation.
3. **Corruption-tolerant**: If the process crashes mid-write, at most one incomplete line appears at the end; previously written lines are unaffected.

### Replay on Every Read

`JsonlSessionStore` does not maintain an in-memory cache. Every `getSession`, `listMessages`, and `listTraceEvents` call replays the JSONL file from scratch. This is simpler and safer than cache invalidation for a project-scale workload. If performance becomes a concern, a caching layer can be added above the `SessionStore` interface without changing the store itself.

### Session ID Safety

`JsonlSessionStore` constructs file paths as `{directory}/{sessionId}.jsonl`. Before constructing any path, `assertSafeSessionId(sessionId)` verifies that the ID matches `^[A-Za-z0-9_-]+$` — no path separators, no dots, no special characters. This prevents directory traversal attacks via crafted session IDs.

### Session Listing

`listSessions` on `JsonlSessionStore` reads the directory with `readdir`, filters for `.jsonl` files, and replays each one to get its `updatedAt`. Sessions are then sorted by `updatedAt` descending. This is O(n × file_size) but is acceptable for interactive session lists where n is small.

### Defensive Copies

Both store implementations always return copies of records (spread for plain objects, `structuredClone` for trace events with nested objects). This prevents callers from mutating stored records, which would silently corrupt the in-memory store.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the sessions package, export entrypoint, and build scripts (no workspace package dependencies). |
| `tsconfig.json` | TypeScript config | Builds the sessions package. |
| `src/index.ts` | Session store | All exports: `SessionRecord`, `SessionMessageRecord`, `SessionTraceEventRecord`, `SessionStore`, `InMemorySessionStore`, `JsonlSessionStore`, `InMemorySessionStoreDependencies`, `JsonlSessionStoreDependencies`. |
| `src/index.test.ts` | Session tests | Protects create/list/get, message append/list ordering, trace event persistence, `limit` queries, `updatedAt` bumping, defensive copies, JSONL replay correctness, and unsafe session ID rejection. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

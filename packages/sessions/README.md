# Sessions Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/sessions` owns the **session persistence boundary**: it stores conversation messages and runtime trace events with session scope, and serializes cross-process writes with a sidecar file lock. It keeps persistence concerns completely separate from runtime orchestration, permission logic, and UI rendering.

```
CLI / Web adapter
    │  stores messages and trace events
    ▼
SessionStore (interface)
    ├─ InMemorySessionStore   (in-process, for testing and ephemeral use)
    └─ JsonlSessionStore      (JSONL files + per-session .lock sidecar)
                                └─ acquireSessionFileLock (cross-process)
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
  content: string | null;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolCallId?: string;
  createdAt: string;
}
```

`content` is `null` for assistant messages that contain only tool calls (no text). `toolCalls` carries the structured tool call list for assistant messages. `toolCallId` links a `tool`-role message back to its originating tool call.

A `SessionTraceEventRecord<TEvent>` is a generic wrapper around any event type (typically `RuntimeEvent` from `@vole/core`):

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
  appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void>;
}
```

`appendCompactBoundary` writes a `compact_boundary` record to the session JSONL. When the CLI adapter detects a `compaction_triggered` event with a summary, it calls this method to mark where in the message history the compaction occurred.

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
{"type":"message","message":{"id":"msg_qrs","role":"assistant","content":null,"toolCalls":[{"id":"tc_1","name":"read_file","input":{"path":"foo.ts"}}],"createdAt":"…"}}
{"type":"message","message":{"id":"msg_rst","role":"tool","content":"<file contents>","toolCallId":"tc_1","createdAt":"…"}}
{"type":"compact_boundary","summary":"Conversation summary:\n…","messagesBefore":35,"messagesAfter":14,"createdAt":"…"}
{"type":"trace","traceEvent":{"sessionId":"sess_abc","event":{"type":"run_completed",…},"createdAt":"…"}}
```

This format has four important properties:
1. **Append-only writes**: Every `appendMessage`, `appendTraceEvent`, and `appendCompactBoundary` call appends exactly one line. No lines are ever modified or deleted.
2. **Replayable**: The entire session state can be reconstructed by reading lines in order — the `#replay()` method does this on every read operation. When `#replay()` encounters a `compact_boundary` record, it discards all previously accumulated messages and restarts from a fresh messages array with the summary as a `role: "system"` message. This means after a compaction, `listMessages()` only returns messages from after the boundary — older messages are logically replaced by the summary.
3. **Corruption-tolerant**: If the process crashes mid-write, at most one incomplete line appears at the end; previously written lines are unaffected.
4. **Full tool context preserved**: The adapter persists every message from each turn — `user`, `assistant` (with `toolCalls`), and `tool` (with `toolCallId`) — not just the final user and assistant pair. This means the complete tool call context is recoverable on session resume.

### Replay on Every Read

`JsonlSessionStore` does not maintain an in-memory cache. Every `getSession`, `listMessages`, and `listTraceEvents` call replays the JSONL file from scratch. This is simpler and safer than cache invalidation for a project-scale workload. If performance becomes a concern, a caching layer can be added above the `SessionStore` interface without changing the store itself.

### Session ID Safety

`JsonlSessionStore` constructs file paths as `{directory}/{sessionId}.jsonl`. Before constructing any path, `assertSafeSessionId(sessionId)` verifies that the ID matches `^[A-Za-z0-9_-]+$` — no path separators, no dots, no special characters. This prevents directory traversal attacks via crafted session IDs.

### Session Listing

`listSessions` on `JsonlSessionStore` reads the directory with `readdir`, filters for `.jsonl` files, and replays each one to get its `updatedAt`. Sessions are then sorted by `updatedAt` descending. This is O(n × file_size) but is acceptable for interactive session lists where n is small.

### Session Storage Location

The `sessions.directory` field in `EffectiveConfig` controls where JSONL files are written. The default value is `~/.vole/sessions`, but adapters may override it before constructing the store.

The CLI adapter (`apps/cli/src/index.ts`) implements **project-scoped sessions**: at startup it walks up the directory tree looking for a `.git` directory (`findGitRoot()`). If a git root is found, sessions are stored under `<git-root>/.vole/sessions/` so that session history stays with the repository. If no git root exists, it falls back to the global `~/.vole/sessions/`. This detection logic lives entirely in the CLI adapter layer — `@vole/sessions` itself is storage-location-agnostic and simply writes to whatever directory it is given.

### Defensive Copies

Both store implementations always return copies of records (spread for plain objects, `structuredClone` for trace events with nested objects). This prevents callers from mutating stored records, which would silently corrupt the in-memory store.

### Cross-Process File Lock

`JsonlSessionStore` wraps every JSONL append in a sidecar file lock at `{directory}/{sessionId}.lock`. The lock file is a small JSON document containing the holder's pid and `startedAt` timestamp. Acquisition uses Node's `wx` flag (atomic create-if-not-exists). When the lock is already held, the acquirer polls every `retryIntervalMs` (default 50 ms) until the holder releases or the lock is determined stale, with a total timeout of `acquireTimeoutMs` (default 60 s).

A lock is treated as stale if its `startedAt` is older than `staleAfterMs` (default 60 s) or if the holding pid is no longer alive (`process.kill(pid, 0)` throws `ESRCH`). Stale locks are deleted and re-acquired by the next waiter, so a crashed process does not permanently block subsequent invocations.

The lock layer composes with the in-process session lane in `@vole/lanes`: lanes serialize submissions within one Node process, file lock serializes across processes. For tests, pass `fileLock: { enabled: false }` to construct a store without the locking overhead.

`acquireSessionFileLock(lockPath, options)` is exported as a stand-alone helper. Use it when you need cross-process safety around custom file operations that target the sessions directory.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the sessions package, export entrypoint, and build scripts (no workspace package dependencies). |
| `tsconfig.json` | TypeScript config | Builds the sessions package. |
| `src/index.ts` | Session store | All exports: `SessionRecord`, `SessionMessageRecord`, `SessionTraceEventRecord`, `SessionStore`, `InMemorySessionStore`, `JsonlSessionStore`, `InMemorySessionStoreDependencies`, `JsonlSessionStoreDependencies`, `JsonlFileLockOptions`, `acquireSessionFileLock`, `SessionFileLock`, `AcquireSessionFileLockOptions`, `DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS`, `DEFAULT_LOCK_RETRY_INTERVAL_MS`, `DEFAULT_LOCK_STALE_AFTER_MS`. |
| `src/index.test.ts` | Session tests | Protects create/list/get, message append/list ordering, trace event persistence, `limit` queries, `updatedAt` bumping, defensive copies, JSONL replay correctness, unsafe session ID rejection, `compact_boundary` replay (messages reset to summary), `toolCalls`/`toolCallId` field persistence, file lock acquisition / release / idempotence / timeout / stale-pid reclaim / stale-age reclaim / in-process serialization, and store-level lock integration. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

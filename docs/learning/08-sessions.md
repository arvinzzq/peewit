# Module 07: @vole/sessions

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `08-sessions.zh-CN.md` (create alongside this file)

Related source: `packages/sessions/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [07-context.md](./07-context.md) — context assembly consumes session messages
as `recentMessages`, and this is where those messages come from.

**Before reading**: Read `packages/sessions/src/index.ts` in full. Notice that there are
two store implementations: `InMemorySessionStore` and `JsonlSessionStore`.

**Focus questions**:
- What is the JSONL format and why is it used here?
- What does `#replay()` do, and what are its performance implications?
- If a session file has 50 messages with a `compact_boundary` after message 20, how many
  messages does `listMessages()` return? Which ones?
- Why is `SessionMutex` in `@vole/core` rather than here?
- What is the difference between `SessionMessageRecord` and `ModelMessage`?
- `@vole/sessions` uses append-only writes; `@vole/taskflow` uses read-modify-write.
  Why does each module choose a different strategy?

**Checkpoint**: You understand this module when you can describe what a session file looks
like on disk, trace a `listMessages()` call through the `#replay()` method including
`compact_boundary` handling, and explain why `@vole/sessions` is called a "dumb store".

## 1. What This Module Does

**Plain language**: A session is a journal. Every conversation has one journal (file).
Entries are added to the bottom, never erased. To read the current state, you replay the
journal from the beginning. This makes writes crash-safe (old entries survive a power
outage) and the storage format human-readable — you can open the raw file and see exactly
what happened.

**Technical summary**: `@vole/sessions` persists conversation history and runtime trace
events to disk. It provides two implementations of `SessionStore`: an in-memory store for
testing and a JSONL file store for production. Each session is a single append-only
`.jsonl` file containing four record types: session metadata, messages, compact boundaries,
and trace events.

## 2. Why It Exists

Without session storage, the agent has no memory between turns. When a new turn starts,
the adapter could not reload the conversation history to pass as `recentMessages` to
context assembly. The agent would start every turn from scratch.

`@vole/sessions` is also the persistence layer for the execution trace (runtime events).
Trace records let adapters show conversation history, replay runs, and debug what happened
in past turns.

## 3. Public Interface

```ts
interface SessionStore {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>
  getSession(sessionId: string): Promise<SessionRecord | undefined>
  listSessions(query?: ListSessionsQuery): Promise<SessionRecord[]>

  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>
  listMessages(sessionId: string, query?: ListSessionMessagesQuery): Promise<SessionMessageRecord[]>

  appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>>
  listTraceEvents<TEvent>(sessionId: string, query?: ListSessionTraceEventsQuery): Promise<SessionTraceEventRecord<TEvent>[]>

  appendCompactBoundary(input: AppendCompactBoundaryInput): Promise<void>
}

interface SessionRecord {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

interface SessionMessageRecord {
  id: string
  sessionId: string
  role: "user" | "assistant" | "tool" | "system"
  content: string | null
  toolCalls?: Array<{ id: string; name: string; input: unknown }>
  toolCallId?: string
  createdAt: string
}
```

`content` is `null` for assistant messages that contain only tool calls (no text). `toolCalls` carries structured tool call data for assistant messages. `toolCallId` links a `tool`-role result message back to its originating call. `appendCompactBoundary` writes a `compact_boundary` record that signals where compaction occurred; `#replay()` uses it to discard old messages.

interface SessionTraceEventRecord<TEvent = unknown> {
  sessionId: string
  event: TEvent      // typed as generic — can hold any RuntimeEvent
  createdAt: string
}
```

Two implementations: `InMemorySessionStore` (for tests) and `JsonlSessionStore` (for
production, requires a `directory` path).

## 4. Implementation Walkthrough

### On-disk format

Each session lives in one `.jsonl` file (`<sessionId>.jsonl`). Each line is a complete
JSON object. Four record types share the file:

```jsonl
{"type":"session","session":{"id":"sess_abc","createdAt":"2026-05-07T10:00:00Z","updatedAt":"..."}}
{"type":"message","message":{"id":"msg_1","sessionId":"sess_abc","role":"user","content":"Hello",...}}
{"type":"message","message":{"id":"msg_2","sessionId":"sess_abc","role":"assistant","content":null,"toolCalls":[{"id":"tc_1","name":"read_file","input":{"path":"foo.ts"}}],...}}
{"type":"message","message":{"id":"msg_3","sessionId":"sess_abc","role":"tool","content":"<file contents>","toolCallId":"tc_1",...}}
{"type":"compact_boundary","summary":"Conversation summary:\n…","messagesBefore":35,"messagesAfter":14,"createdAt":"..."}}
{"type":"trace","traceEvent":{"sessionId":"sess_abc","event":{"type":"run_started",...},...}}
```

### The replay pattern

Every `JsonlSessionStore` read operation calls `#replay(sessionId)`:

```ts
async #replay(sessionId) {
  const content = await readFile(filePath, "utf8")

  for (const line of content.split("\n")) {
    const record = JSON.parse(line)
    if (record.type === "session")  session = record.session
    if (record.type === "message")  messages.push(record.message)
    if (record.type === "trace")    traceEvents.push(record.traceEvent)
    if (record.type === "compact_boundary") {
      // discard all accumulated messages; restart from the summary
      messages = [{ role: "system", content: record.summary, ... }]
    }
  }

  return { session, messages, traceEvents }
}
```

When `#replay()` encounters a `compact_boundary` record, it clears the messages array and
inserts a synthetic `role: "system"` message containing the compaction summary. This means
`listMessages()` only returns messages from after the most recent boundary — old messages
are logically replaced by the summary and never reconstructed.

There is no in-memory cache. Every call to `listMessages()`, `appendMessage()`, or
`listTraceEvents()` re-reads and re-parses the entire file from disk.

### Append-only writes

```ts
async #append(sessionId, record) {
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, JSON.stringify(record) + "\n", { flag: "a" })
}
```

`flag: "a"` opens the file for appending. Writes never overwrite existing lines.
If the process crashes mid-write, previous records are intact and recoverable.

### Session ID safety

```ts
function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error(...)
}
```

Called before constructing the file path. Prevents `../../../etc/passwd`-style path
traversal attacks when session IDs come from user input.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| `session-store.ts` | `JsonlSessionStore` | Persistent session store |
| Session-level write locks | `SessionMutex` in `@vole/core` | Concurrency at a higher layer |
| Transcript persistence | `appendMessage` / `listMessages` | Same concept |
| Per-session execution trace | `appendTraceEvent` / `listTraceEvents` | OpenClaw traces are more detailed |

OpenClaw's session store uses SQLite for indexed queries and concurrent access. Vole uses
append-only JSONL files, which are simpler to inspect and debug but rebuild state on every
read.

## 6. Key Design Decisions

**JSONL append-only format**

JSONL (JSON Lines) stores one JSON object per line. The file is write-once-at-a-time:
new records are appended, old records are never modified. This gives:
- **Crash safety**: a partial write at the end of the file leaves all previous records
  intact. If the last line is corrupt, everything before it is recoverable.
- **Human-readable**: you can `cat` a session file and read the full conversation history.
- **No migrations**: the format is a sequence of typed records; new record types can be
  added without breaking existing files.

**Replay on every read — no cache**

`JsonlSessionStore` re-reads and re-parses the entire file on every operation. There is
no in-memory state between calls. This is simple and correct, but has a linear read cost
as sessions grow. The design is appropriate for sessions of hundreds of messages; for
sessions with tens of thousands of messages it would be slow.

The tradeoff: no cache means no cache invalidation bugs, no stale reads, and no memory
pressure from keeping sessions resident.

**`SessionMutex` lives in `@vole/core`, not here**

The sessions package has no concurrency protection. `SessionMutex` is owned by
`AgentRuntime`. This keeps the separation clean: sessions is pure storage with no
concurrency logic; core is the coordinator that decides when runs may execute.

If sessions had its own mutex, it would need to know about run boundaries — knowledge
that belongs to core.

**`compact_boundary` persists the compaction result**

When `AgentRuntime` emits a `compaction_triggered` event with a non-empty `summary`, the
CLI adapter calls `appendCompactBoundary()`. This writes a `compact_boundary` line to the
session JSONL. On the next session load, `#replay()` encounters the boundary and resets
the messages array to just the summary — the agent starts the new turn with compact history
already applied.

Without this persistence, the agent would need to re-compact on every session load:
paying the model API cost again and potentially producing a different summary. Writing the
boundary once means compaction is done exactly once and its result is durable.

The boundary also records `messagesBefore` and `messagesAfter` counts, which make session
files self-documenting about where compaction occurred.

**`SessionTraceEventRecord` is generic**

```ts
interface SessionTraceEventRecord<TEvent = unknown> { event: TEvent }
```

The sessions package does not import from `@vole/core`. It stores whatever event is
passed to `appendTraceEvent`. This prevents a circular dependency (core → sessions,
sessions → core) and makes the storage layer reusable with any event type.

## 7. Testing Approach

Tests are in `packages/sessions/src/index.test.ts`. `InMemorySessionStore` is tested
for correctness with no filesystem. `JsonlSessionStore` tests use a real temporary
directory (`mkdtemp`) — no mocking of Node.js file APIs.

Test categories:
- Session creation and retrieval
- Message append and list (ordering, limit)
- Trace event append and list
- JSONL file format verification (raw file content assertions)
- `updatedAt` derivation from appended records
- Session ID safety enforcement
- Missing session file returns empty (not an error)

## 8. Insights

**The replay pattern is a form of event sourcing.** The JSONL file is an immutable log
of events. State (current messages, current trace) is derived by replaying the log.
This is the same pattern used in event-sourced databases and Kafka consumers — the log
is the source of truth, not an in-memory representation.

**`SessionMessageRecord` and `ModelMessage` are different types.** `SessionMessageRecord`
is a persistence record with `id`, `sessionId`, and `createdAt`. `ModelMessage` is an
in-flight payload sent to the model API. The adapter converts between them: it reads
`SessionMessageRecord[]` from the store and maps them to `ModelMessage[]` before
passing them to context assembly as `recentMessages`.

**`updatedAt` is derived during replay, not stored separately.** The `SessionRecord`'s
`updatedAt` is updated during `#replay()` based on the latest `createdAt` timestamp
across messages and trace events. This means `updatedAt` is always consistent with actual
activity, not with a potentially stale stored value.

**Session IDs are validated as a security boundary.** A session ID constructed from
user input that contains `../` would resolve to a path outside the sessions directory.
`assertSafeSessionId` blocks this at the file path construction step — it's a defence
against injection via session ID.

**Sessions is a "dumb store" — no logic above storage.** `@vole/sessions` has no
business logic, no concurrency protection, no caching, and no knowledge of the agent
loop. All decisions about what to write and when belong to the adapter (CLI). This
boundary is intentional: keeping sessions dumb means it can be tested, replaced, or
extended without touching core logic.

**Append-only (sessions) vs read-modify-write (taskflow) — two different semantics.**
Sessions uses append-only writes because conversation history is an immutable event
stream — past messages are never revised. Taskflow uses read-modify-write because task
status is a mutable entity — a task transitions from `queued` to `running` to
`succeeded`, and only the current state matters. The right write strategy follows
directly from the nature of the data.

**CLI is the bridge — sessions and core are fully decoupled.** `@vole/core` emits
`turn_complete` and `compaction_triggered` events but never calls any session method.
`@vole/sessions` stores messages but never imports from core. Only the CLI adapter
knows about both: it listens to core events and decides what to persist. This decoupling
means sessions can be swapped (e.g., SQLite backend) without touching core, and core
can be tested without any file system.

## 9. Review Questions

1. What are the four record types in a session JSONL file? What is each used for?
   > `session` — stores session metadata (id, title, timestamps). `message` — stores one
   > conversation message (user, assistant, tool, or system role) including optional
   > `toolCalls` and `toolCallId` fields. `compact_boundary` — marks where a compaction
   > occurred; contains the summary text and before/after message counts; `#replay()` uses
   > it to reset the messages array to just the summary. `trace` — stores a runtime event
   > record for debugging and observability.

2. What does `#replay()` do? If a session file has 50 messages with a `compact_boundary`
   after message 20, how many messages does `listMessages()` return?
   > Reads the entire session file line by line, reconstructs session metadata, messages,
   > and trace events. When it encounters a `compact_boundary` record, it resets the
   > messages array and inserts the summary as the sole `role: "system"` message, then
   > continues appending subsequent messages. Result: `listMessages()` returns 31 messages
   > (1 summary + messages 21–50). Messages 1–20 are still in the file but never returned.
   > Time and I/O complexity: O(N) per read operation regardless of the query.

3. Why is `SessionMutex` in `@vole/core` rather than in `@vole/sessions`?
   > Mutex belongs at the run-coordination level, not the storage level. Sessions stores
   > data; core decides when runs may proceed. If sessions held a mutex, it would need to
   > understand run boundaries — knowledge that belongs to core. Keeping them separate
   > prevents circular dependency and maintains clean boundary discipline.

4. What is the difference between `SessionMessageRecord` and `ModelMessage`?
   > `SessionMessageRecord` is a persistence record: it has `id`, `sessionId`, `createdAt`,
   > and persisted `content`. `ModelMessage` is an in-flight payload for the model API:
   > it has `role`, `content`, and optional `toolCalls` / `toolCallId`. The adapter maps
   > `SessionMessageRecord[]` → `ModelMessage[]` before passing them to context assembly.

5. Why is `SessionTraceEventRecord<TEvent>` generic rather than typed to `RuntimeEvent`?
   > To avoid a circular dependency: `@vole/core` depends on `@vole/sessions` for storage,
   > and `@vole/sessions` must not import from `@vole/core`. The generic type parameter
   > allows sessions to store any event without knowing its shape, keeping the packages
   > decoupled.

6. What happens if a session JSONL file has a corrupt last line (e.g., from a crash
   mid-write)?
   > `#replay()` calls `JSON.parse(line)` on each line. A corrupt line throws a parse
   > error, which propagates to the caller. The current implementation does not skip
   > corrupt lines. Recovery requires manually removing the corrupt last line from the file.

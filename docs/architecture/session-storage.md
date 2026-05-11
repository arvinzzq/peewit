# Session Storage

Status: Active
Date: 2026-05-11

Simplified Chinese version: [session-storage.zh-CN.md](./session-storage.zh-CN.md)

## 1. Purpose

Session storage persists the conversation and execution history of Vole.

The MVP needs session storage so users can continue a CLI conversation, inspect recent trace events, and understand what happened in previous turns.

The core rule:

MVP includes session memory, but not a full long-term memory system.

## 2. Session Memory vs Long-Term Memory

Vole should distinguish session memory from long-term memory.

| Concept | MVP Status | Meaning |
| --- | --- | --- |
| Session memory | Included | Conversation history, user turns, assistant responses, tool observations, trace events for a session |
| Long-term memory | Deferred | Cross-session user preferences, durable knowledge, semantic retrieval, vector indexes, knowledge graph |

Session memory is required for MVP because the agent needs continuity inside a conversation.

Long-term memory is deferred to a later phase because it introduces more design questions:

- What should be remembered?
- Who approves memory writes?
- How is memory edited or deleted?
- How are private facts protected?
- How does retrieval avoid stale or wrong context?

## 3. Why This Module Exists

Without session storage, every CLI run is stateless. That makes the product less useful and makes the learning goal weaker because users cannot inspect how a task unfolded.

Session storage gives Vole:

- Conversation continuity
- Trace inspection
- Task history
- Debugging support
- A foundation for Web UI session views
- A path toward future memory systems

## 4. MVP Scope

MVP session storage should support:

- Creating a session
- Appending user messages
- Appending assistant messages (with `toolCalls` for messages that include tool call data)
- Appending tool result messages (with `toolCallId` linking back to the originating call)
- Appending trace events
- Appending `compact_boundary` records to persist compaction results durably
- Listing recent sessions
- Loading a session
- Showing recent trace details through CLI

The adapter persists all messages from each turn — not just the final user+assistant pair.
Tool call context (assistant messages with `toolCalls`, tool result messages with `toolCallId`)
is preserved so the session can be resumed with full context intact.

MVP does not need:

- Semantic search
- Vector storage
- Cross-session memory extraction
- Cloud sync
- Multi-user accounts
- Shared team workspaces

## 5. Storage Backend

The MVP uses a simple local file-based backend.

Default location:

```text
~/.vole/sessions/
```

**Project-local session storage is implemented.** The CLI detects the git repository root on startup. When a git root is found, sessions are stored under `<git-root>/.vole/sessions/`, keeping session history co-located with the project. When no git root is found, the CLI falls back to `~/.vole/sessions/`.

The storage interface stays abstract so later implementations can use SQLite, cloud sync, or encrypted storage.

## 6. Session Record

A session record should include:

- Session ID
- Created timestamp
- Updated timestamp
- Workspace root
- Entry adapter, such as CLI
- Default autonomy mode
- Model provider summary
- Title or first user goal
- Message references
- Trace references

The exact serialization can be chosen during implementation, but records should be structured and versioned.

## 7. Message Record

Message records should include:

- Message ID
- Session ID
- Role: user, assistant, tool, system summary
- Timestamp
- Content
- Related tool call ID, if any
- Related trace event IDs, if any
- Redaction metadata when relevant

Large tool outputs should not always be stored as ordinary chat messages. They may be stored as tool result records and summarized in messages.

## 8. Trace Record

Trace records should be associated with sessions.

Trace storage should support:

- Appending events
- Loading recent events
- Loading events for a user turn
- Filtering by visibility level
- Redacting sensitive content before display

Trace records should be structured so CLI and future Web UI can render them differently.

Phase 5 stores trace records in the same append-only JSONL file as session messages. This keeps the MVP inspectable: one session file can replay both the conversation and the visible execution timeline.

The JSONL file contains four record types:

```jsonl
{"type":"session","session":{…}}
{"type":"message","message":{"role":"user","content":"Hello",…}}
{"type":"message","message":{"role":"assistant","content":null,"toolCalls":[{…}],…}}
{"type":"message","message":{"role":"tool","content":"result","toolCallId":"tc_1",…}}
{"type":"compact_boundary","summary":"Conversation summary:\n…","messagesBefore":35,"messagesAfter":14,"createdAt":"…"}
{"type":"trace","traceEvent":{…}}
```

`compact_boundary` records mark where context compaction occurred. On replay, the store clears all prior messages and restarts from the summary. This ensures compaction is performed once and its result is durable across process restarts.

## 9. Tool Result Record

Tool results may need their own records when output is large or structured.

A tool result record can include:

- Tool call ID
- Tool name
- Input summary
- Output summary
- Structured result data
- Source path or URL
- Error details
- Timing metadata

The model context should usually receive a compact observation instead of the full tool result.

## 10. Context Reconstruction

When continuing a session, the agent needs to reconstruct useful context.

MVP context reconstruction can use:

- Recent user and assistant messages
- Recent tool observations
- Recent trace summaries
- Current configuration
- Current loaded skills

The MVP should not try to retrieve all historical data. It should keep context bounded.

Future versions may add summarization, semantic retrieval, and long-term memory.

## 11. Session Summaries

Session summaries are useful but optional for early MVP.

Later versions can create summaries for:

- Long conversations
- Completed tasks
- Important decisions
- Reusable project facts

Summaries should not automatically become long-term memory without a policy and user control.

## 12. Privacy and Redaction

Session storage may contain sensitive information.

MVP should:

- Avoid storing API keys
- Redact secret-like values in trace
- Avoid storing full secret-like file contents
- Make storage location explicit
- Keep data local by default

Future versions may add encryption or OS keychain integration.

## 13. Relationship to Memory

Session storage is the foundation for memory, but it is not the full memory system.

Later memory features may include:

- User-approved memory writes
- Editable memory entries
- Forget/delete controls
- Semantic retrieval
- Local knowledge indexes
- Project-specific memory

Keeping memory out of MVP makes the first agent easier to understand, test, and trust.

## 14. CLI Behavior

The CLI should eventually support:

- Starting a new session
- Continuing the latest session
- Listing recent sessions
- Showing trace for the current session
- Clearing or deleting a session

MVP can start with:

- Create session on `vole chat`
- Persist messages and trace events
- `/trace` for current session
- Future command for session listing

## 15. Testing Requirements

Session storage needs tests because it protects user continuity and trace history.

Required test areas:

- Creating sessions
- Appending messages
- Appending trace events
- Replaying trace events from JSONL storage
- Loading sessions
- Context reconstruction boundaries
- Redaction before persistence or display
- Handling missing or corrupt session files
- Storage version migration when schema changes
- CLI behavior for current session trace
- CLI behavior for named-session trace after process restart

Session tests should be updated whenever Agent Loop, Execution Trace, CLI chat, or storage schema changes.

## 16. Acceptance Criteria

The MVP session storage should be considered successful when:

- A CLI chat session has a session ID.
- User and assistant messages can be persisted.
- Tool observations can be associated with the session.
- Trace events can be persisted and loaded.
- `/trace` can show recent current-session events.
- Context reconstruction is bounded and predictable.
- Long-term memory is explicitly deferred.
- Session behavior is covered by unit and integration tests.

## 17. Related Documents

- [Main design](../product/vole-design.md)
- [Roadmap](../roadmap/overview.md)
- [Agent loop](./agent-loop.md)
- [Execution trace](./execution-trace.md)
- [Permission system](./permission-system.md)
- [Project structure](./project-structure.md)

# Phase 5 Sessions and Memory Plan

Status: In Progress
Date: 2026-05-03

Simplified Chinese version: [phase-5-sessions-and-memory.zh-CN.md](./phase-5-sessions-and-memory.zh-CN.md)

## Progress

Status: In Progress

Completed:

- In-memory session store with ordered message records: `5ed6ca9`
- Context assembly support for recent session messages: `827a08d`
- Runtime handoff for recent messages: `3e0447a`
- CLI short-term memory within one interactive session: `2a22822`
- Durable JSONL session storage behind `SessionStore`: `f311687`
- CLI named sessions backed by JSONL storage: `e634f54`
- Session listing in stores and CLI: `08bc0ed`, `b3ecd92`
- Durable trace events in session stores: `0b10494`
- CLI named-session trace persistence across process runs: `dd5a2a1`
- CLI latest-session resume with `chat --resume`: `325b8f2`
- Workspace prompt loading for `AGENTS.md` and `SOUL.md`: `a2bca8e`, `719e805`, `15ce35c`
- Long-term memory disabled/read-only policy and CLI visibility: `b737c68`, `db89088`
- Read-only `USER.md` and `MEMORY.md` loading when enabled: `fafe13f`
- Read-only today/yesterday daily memory loading when enabled: pending commit

Remaining:

- Daily memory write policy and future daily note creation.

Latest verification:

- `pnpm run check`
- `pnpm vitest run packages/sessions/src/index.test.ts`
- `pnpm vitest run packages/context/src/index.test.ts`
- `pnpm vitest run packages/core/src/index.test.ts`
- `pnpm vitest run apps/cli/src/index.test.ts`

Next recommended slice:

- Define daily memory write policy before creating or updating `memory/YYYY-MM-DD.md`.

## 1. Purpose

This phase gives ArvinClaw short-term and durable memory.

The OpenClaw-like target is a visible agent workspace where sessions, memory, identity, user preferences, and daily notes can be inspected and controlled by the user.

## 2. User Result

The user should be able to:

- Continue a conversation without losing recent turns.
- Inspect or resume prior sessions.
- Understand what context the agent used.
- Approve any future long-term memory writes.

## 3. Scope

This phase includes:

- Session records.
- Message records.
- Durable session storage.
- Recent conversation history in context assembly.
- Trace persistence hooks.
- Session resume commands.
- Later workspace memory files.

This phase does not include:

- Silent long-term memory writes.
- Background memory promotion.
- Multi-agent memory sharing.
- Remote memory sync.

## 4. Short-Term Memory

Short-term memory means recent conversation messages from the current session.

Current first slice:

```text
CLI interactive session
  -> read recent session messages
  -> pass recent messages to AgentRuntime
  -> ContextAssembler places them before the current user message
  -> after the turn, append user and assistant messages to the session
```

Configured CLI chat now uses durable JSONL storage. Named sessions can be selected with:

```bash
pnpm run cli chat --session my_session
```

The most recently updated stored session can be resumed with:

```bash
pnpm run cli chat --resume
```

If no session is specified, the CLI creates a generic `session_<id>` session. Session IDs are agent-level identifiers and should not encode the entry adapter such as CLI or Web UI. The default storage directory is `~/.arvinclaw/sessions`.

Configured CLI chat also loads `AGENTS.md` and read-only `SOUL.md` from the configured workspace root when those files exist. The workspace root can be set with `ARVINCLAW_WORKSPACE_ROOT`.

Long-term memory files remain disabled by default. `ARVINCLAW_LONG_TERM_MEMORY=read-only` loads `USER.md`, `MEMORY.md`, `memory/<today>.md`, and `memory/<yesterday>.md` from the configured workspace root when present, while memory writes stay disabled.

## 5. Durable Session Storage

The durable target is JSONL session storage similar to OpenClaw's replayable session direction.

Initial storage shape:

```text
~/.arvinclaw/sessions/
  <session-id>.jsonl
```

Each line should be a structured record such as:

```json
{"type":"message","id":"msg_1","sessionId":"sess_1","role":"user","content":"Hello","createdAt":"..."}
```

The JSONL store is append-only so a session can be replayed in order and later extended with trace or tool records without rewriting history.

Trace records use the same JSONL file as messages. This keeps each named session replayable from one append-only file and makes `/trace` work after a CLI process restart.

## 6. Long-Term Memory

Long-term memory belongs after durable sessions.

Planned OpenClaw-like files:

- `USER.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

The agent must not write these files silently. Memory promotion should be explicit and reviewable.

## 7. Tests

Required tests:

- Session creation and message ordering.
- Recent message limits.
- Defensive copies from stores.
- Context assembly order with recent messages.
- Runtime pass-through of recent messages.
- CLI second-turn provider request includes first-turn history.
- JSONL append/load behavior.
- Unsafe session ID rejection before writing files.
- CLI named sessions persist history across process runs.
- Session listing shows stored sessions by recent update.
- Trace persistence in `SessionStore` and configured CLI chat.
- `/trace` can replay persisted trace for a named session after process restart.
- CLI `chat --resume` continues the most recently updated stored session.
- Workspace prompt files are included in configured-provider context when present.
- Long-term memory file access is policy-gated and visible through `/config`.
- `USER.md` and `MEMORY.md` are included only in read-only long-term memory mode.
- Today's and yesterday's daily memory files are included only in read-only long-term memory mode.

## 8. Acceptance Criteria

This phase is complete when:

- Sessions persist across process runs.
- CLI can resume the latest stored session.
- Recent session history is included in context.
- Trace and message history can be inspected.
- Long-term memory write policy is documented before any writes are implemented.

## 9. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Memory System](../architecture/memory-system.md)
- [Session Storage](../architecture/session-storage.md)
- [Context Engine](../architecture/context-engine.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)

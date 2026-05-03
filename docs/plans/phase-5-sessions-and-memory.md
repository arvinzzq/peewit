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

Remaining:

- Session listing commands.
- Trace persistence alongside message persistence.
- Session resume command.
- Workspace prompt loading for `AGENTS.md` and `SOUL.md`.
- Long-term memory files such as `USER.md`, `MEMORY.md`, and `memory/YYYY-MM-DD.md`.

Latest verification:

- `pnpm run check`
- `pnpm vitest run packages/sessions/src/index.test.ts`
- `pnpm vitest run packages/context/src/index.test.ts`
- `pnpm vitest run packages/core/src/index.test.ts`
- `pnpm vitest run apps/cli/src/index.test.ts`

Next recommended slice:

- Add session listing and trace persistence.

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

The default configured session ID is `cli_session`, and the default storage directory is `~/.arvinclaw/sessions`.

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

Trace records can use the same file or a sibling trace file. The final choice should be documented before implementation.

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
- Future resume command behavior.

## 8. Acceptance Criteria

This phase is complete when:

- Sessions persist across process runs.
- CLI can resume a stored session.
- Recent session history is included in context.
- Trace and message history can be inspected.
- Long-term memory write policy is documented before any writes are implemented.

## 9. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Memory System](../architecture/memory-system.md)
- [Session Storage](../architecture/session-storage.md)
- [Context Engine](../architecture/context-engine.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)

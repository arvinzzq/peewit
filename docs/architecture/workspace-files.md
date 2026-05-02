# Workspace Files

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [workspace-files.zh-CN.md](./workspace-files.zh-CN.md)

## 1. Purpose

Workspace files are the visible, editable surfaces where an OpenClaw-like agent stores instructions, identity, memory, and environment notes.

ArvinClaw should support this model because it makes agent behavior inspectable and learnable.

The core rule:

Workspace files can influence agent behavior, but they must not bypass tools, permissions, redaction, or trace.

## 2. Why This Module Exists

OpenClaw uses workspace files as a central part of the agent's home.

ArvinClaw needs a clear workspace-file policy so that:

- Prompt loading is predictable.
- Users can inspect and edit agent context.
- Memory is visible instead of hidden in opaque state.
- Sensitive files are not accidentally injected.
- Identity files are protected from silent modification.
- Future gateway and background runs share the same context rules.

## 3. Planned Files

ArvinClaw should support these OpenClaw-like files over time.

| File | Purpose | MVP Status |
| --- | --- | --- |
| `AGENTS.md` | Operating rules and project instructions | Early |
| `SOUL.md` | Agent identity, values, tone, and boundaries | Phase 1-2 |
| `USER.md` | User preferences and durable personal context | Phase 5 |
| `MEMORY.md` | Curated long-term memory | Phase 5 |
| `memory/YYYY-MM-DD.md` | Daily notes and recent observations | Phase 5 |
| `TOOLS.md` | Environment and tool notes | Phase 5-6 |
| `HEARTBEAT.md` | Background automation instructions | Phase 8 |
| `BOOTSTRAP.md` | Startup bootstrap context | Deferred |

MVP should not load all files automatically.

## 4. Workspace Location

ArvinClaw should distinguish:

- Workspace directory: editable agent/project context
- User data directory: sessions, credentials, cache, local state

Suggested defaults:

```text
<project>/
  AGENTS.md
  skills/
  arvinclaw.config.json

~/.arvinclaw/
  sessions/
  config.json
```

Credentials and secrets should not live in workspace prompt files.

## 5. Loading Stages

Workspace files should be introduced in stages.

### MVP / Phase 1

Load:

- `AGENTS.md`, if present and enabled

Do not load:

- `USER.md`
- `MEMORY.md`
- Daily memory files

### Phase 1-2

Add:

- Read-only `SOUL.md`

### Phase 5

Add with explicit memory policy:

- `USER.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

### Later

Add when background and tool systems are ready:

- `TOOLS.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`

## 6. File Responsibilities

### `AGENTS.md`

Contains operational rules and project instructions.

Examples:

- How to run tests
- Coding conventions
- Project-specific constraints
- Documentation policy
- Commit policy

`AGENTS.md` can be edited by users or project maintainers.

### `SOUL.md`

Defines agent identity:

- Values
- Tone
- Communication style
- Boundaries
- Relationship to memory and growth

`SOUL.md` should be read-only by default from the agent's perspective. Agent self-modification should require explicit user approval.

### `USER.md`

Stores durable user preferences and personal context.

It may include sensitive information, so automatic writes should be deferred until privacy and approval policy are ready.

### `MEMORY.md`

Stores curated long-term memory.

It should contain durable facts, decisions, preferences, and project knowledge. It should not become a raw transcript dump.

### `memory/YYYY-MM-DD.md`

Stores daily notes and recent observations.

Daily notes can help bridge short-term and long-term memory, but they should not be treated as automatically trusted truth.

### `TOOLS.md`

Documents environment and tool notes.

It may include:

- Available commands
- Environment quirks
- Tool limitations
- Safe usage notes

It must not contain secrets.

### `HEARTBEAT.md`

Documents background automation behavior.

It should not be active until background automation and run queue policies are stable.

### `BOOTSTRAP.md`

Provides startup bootstrap context.

This should be deferred because uncontrolled bootstrap context can easily become prompt-injection surface area.

## 7. Loading Order

Future OpenClaw-like loading order:

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Recent daily memory, if enabled
  -> TOOLS.md, if enabled
  -> Session resume context
  -> Skill index
  -> Tool definitions
  -> User message
```

MVP order should remain smaller:

```text
Base system instructions
  -> AGENTS.md, if enabled
  -> Runtime metadata
  -> Permission guidance
  -> Skill index
  -> Tool definitions
  -> Session resume context
  -> User message
```

Loading order must be tested.

## 8. Write Policy

Workspace files should have explicit write policies.

| File | Default Agent Write Policy |
| --- | --- |
| `AGENTS.md` | Ask |
| `SOUL.md` | High-risk ask or blocked by default |
| `USER.md` | High-risk ask |
| `MEMORY.md` | Ask, stronger confirmation for personal facts |
| `memory/YYYY-MM-DD.md` | Ask or configured allow |
| `TOOLS.md` | Ask |
| `HEARTBEAT.md` | High-risk ask |
| `BOOTSTRAP.md` | High-risk ask or blocked by default |

No workspace prompt file should be silently modified by the agent in MVP.

## 9. Risk Classification

Suggested permission risks:

- Reading `AGENTS.md`: Low
- Reading `SOUL.md`: Low or Medium, depending on privacy policy
- Reading `USER.md`: Medium or High
- Reading `MEMORY.md`: Medium
- Writing `SOUL.md`: High
- Writing `USER.md`: High
- Writing `MEMORY.md`: Medium or High
- Writing daily memory: Medium
- Writing secret-like content: Blocked

These risks should be refined during implementation.

## 10. Redaction

Before workspace file content enters model context, redaction should scan for:

- API keys
- Tokens
- Private keys
- Credentials
- Secret-like patterns
- Excessively large content

If content is redacted, the trace and prompt assembly report should record that redaction happened.

## 11. Prompt Injection Risks

Workspace files are powerful prompt surfaces.

Risks:

- Malicious instruction in `AGENTS.md`
- Accidental unsafe instruction in `SOUL.md`
- Memory poisoning in `MEMORY.md`
- Secret exposure in `USER.md`
- Tool misuse instructions in `TOOLS.md`

Mitigation:

- Clear loading order
- File-specific trust levels
- Redaction
- Permission policy
- Trace visibility
- Tests for hostile file content

## 12. Trace Requirements

Workspace file loading should be trace-visible.

Trace should include:

- File path
- Whether file was found
- Whether it was loaded
- Whether it was redacted
- Whether it was truncated
- Why it was omitted, if omitted

The trace should not display full sensitive contents.

## 13. Relationship to Memory

Workspace files are not all memory.

- `SOUL.md` is identity.
- `AGENTS.md` is instruction.
- `USER.md` is user context.
- `MEMORY.md` is curated long-term memory.
- Daily memory files are recent notes.

Keeping these concepts separate prevents memory from becoming an unstructured junk drawer.

## 14. Relationship to Context Engine

The context engine decides which workspace files enter a run.

Workspace file loading should be:

- Explicit
- Ordered
- Bounded
- Redacted
- Trace-visible
- Tested

Prompt assembly formats the selected workspace file content into model input.

## 15. Testing Requirements

Workspace files require safety-focused tests.

Required test areas:

- File discovery
- Loading order
- Missing file behavior
- Oversized file truncation
- Redaction
- Prompt injection regression cases
- Write permission classification
- Read-only identity policy
- Trace entries for load/omit/redact/truncate
- Context assembly integration

Workspace file tests should be updated whenever prompt assembly, memory, permissions, or context engine behavior changes.

## 16. Acceptance Criteria

Workspace file design is successful when:

- Each planned file has a documented purpose.
- MVP loading scope is small and explicit.
- Future loading order is documented.
- Write policy is documented per file.
- Risk classification is documented per file type.
- Prompt injection and redaction risks are documented.
- Loading behavior has clear test requirements.

## 17. Related Documents

- [Prompt assembly](./prompt-assembly.md)
- [Context engine](./context-engine.md)
- [Memory system](./memory-system.md)
- [Permission system](./permission-system.md)
- [OpenClaw architecture map](./openclaw-architecture-map.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)

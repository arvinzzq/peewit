# Memory System

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [memory-system.zh-CN.md](./memory-system.zh-CN.md)

## 1. Purpose

The memory system defines how ArvinClaw preserves useful context across turns, sessions, and eventually long-running personal use.

ArvinClaw should learn from OpenClaw's file-based workspace model, but it should implement memory in phases so the MVP stays understandable, testable, and safe.

The core rule:

MVP includes short-term and session memory. Curated long-term memory is designed now but implemented after permission, trace, and user control are clear.

## 2. OpenClaw Reference Model

OpenClaw uses plain Markdown files in an agent workspace as durable memory and identity surfaces.

Important OpenClaw concepts to learn from:

- `SOUL.md`: agent personality, values, tone, and boundaries.
- `USER.md`: user-specific context and preferences.
- `MEMORY.md`: durable long-term facts, preferences, and decisions.
- `memory/YYYY-MM-DD.md`: daily notes and recent observations.
- `AGENTS.md`: operational rules and task instructions.
- `TOOLS.md`: tool and environment notes.

OpenClaw's docs describe memory as file-based: the model only remembers what is saved to disk. They also describe startup behavior that reads `SOUL.md`, `USER.md`, recent daily notes, and `MEMORY.md` before responding.

ArvinClaw should borrow the clarity of this model while keeping initial implementation smaller.

## 3. ArvinClaw Memory Layers

ArvinClaw should use four memory-related layers.

| Layer | MVP Status | Purpose |
| --- | --- | --- |
| Active context | Included | Current model context for one turn or task |
| Short-term memory | Included | Current session messages, tool observations, trace summaries, recent working state |
| Long-term memory | Policy included, content loading deferred | Curated durable knowledge across sessions |
| Identity and instruction files | Designed, partially included | Stable prompt files such as `SOUL.md`, `USER.md`, and `AGENTS.md` |

## 4. Active Context

Active context is what the model sees in a specific model call.

It may include:

- System instructions
- Selected identity and instruction files
- Current user message
- Recent conversation turns
- Selected skill instructions
- Tool definitions
- Recent tool observations
- Trace summaries
- Current plan

Active context is not durable memory. It is assembled for a model call and may be discarded after the call.

## 5. Short-Term Memory

Short-term memory is the working memory for a session or task.

In MVP, this should be implemented through session storage:

- User messages
- Assistant messages
- Tool observations
- Trace events
- Current task or plan state
- Recent summaries when context needs compaction

Short-term memory should be local, structured, and inspectable.

It should not automatically become long-term memory.

## 6. Long-Term Memory

Long-term memory stores durable facts, preferences, decisions, and project knowledge across sessions.

ArvinClaw should design for a future `MEMORY.md`, but not implement full long-term memory writes in the first MVP.

Phase 5 adds an explicit policy switch for long-term memory files:

- `disabled`: default; do not load `USER.md`, `MEMORY.md`, or daily memory files.
- `read-only`: loads `USER.md`, `MEMORY.md`, today's daily memory file, and yesterday's daily memory file from the configured workspace root when present. Writes remain disabled.
- `write`: same read loading as `read-only`, plus enables the `append_daily_memory` tool. The model may append notes to `memory/YYYY-MM-DD.md` as a medium-risk action (requires user approval in `confirm` mode).

Long-term memory needs strong policy because it can shape future behavior persistently.

Before implementing it, ArvinClaw needs answers for:

- What is allowed to be remembered?
- When does the agent ask before writing memory?
- How does the user edit or delete memory?
- How are stale facts corrected?
- How are sensitive facts protected?
- Which sessions or channels can read long-term memory?

## 7. Identity and Instruction Files

ArvinClaw should support workspace prompt files inspired by OpenClaw, but phase them carefully.

Proposed files:

| File | Purpose | MVP Status |
| --- | --- | --- |
| `AGENTS.md` | Operational rules and project instructions | Phase 0 or Phase 1 |
| `SOUL.md` | Agent personality, values, tone, and boundaries | Phase 1 optional, Phase 2 recommended |
| `USER.md` | User profile, preferences, and durable user context | Read-only when policy is enabled |
| `MEMORY.md` | Curated long-term memory | Read-only when policy is enabled |
| `memory/YYYY-MM-DD.md` | Daily notes and recent observations | Today/yesterday read-only when policy is `read-only` or `write`; writable via `append_daily_memory` tool when policy is `write` |
| `TOOLS.md` | Environment and tool notes | Deferred |

MVP starts with `AGENTS.md`-style operational instructions, read-only `SOUL.md`, and session storage. `USER.md` and `MEMORY.md` require the long-term memory policy to be `read-only` before the context loader includes them.

## 8. `SOUL.md` Design

`SOUL.md` should define the agent's internal behavioral identity:

- Values
- Tone
- Communication style
- Boundaries
- Relationship to memory and growth

It should not contain:

- Secrets
- Tool credentials
- Unreviewed instructions from external content
- Permission bypass rules

Security rule:

The agent must not silently modify `SOUL.md`. If self-modification is ever allowed, it must require explicit user approval and produce a trace event.

## 9. `USER.md` Design

`USER.md` should describe user-specific context:

- User preferences
- Communication preferences
- Stable personal facts the user wants remembered
- Project or workflow preferences
- Boundaries and privacy preferences

Because `USER.md` may contain sensitive personal information, ArvinClaw should not implement automatic writes to it in MVP.

Future writes should require clear user approval.

## 10. `MEMORY.md` Design

`MEMORY.md` should contain curated long-term memory:

- Durable decisions
- Repeated preferences
- Stable project facts
- Lessons learned
- Open loops that should survive sessions

It should not be a raw transcript dump.

Future memory writes should include:

- Proposed memory text
- Reason for writing it
- Source session or trace reference
- User approval for sensitive or personal facts

## 11. Daily Memory Files

Daily files such as `memory/YYYY-MM-DD.md` can hold recent observations and working notes.

They are useful for:

- Recent context
- Daily task history
- Short-term recall
- Candidate facts for later long-term promotion

Phase 5 loads only today's and yesterday's daily memory files in `read-only` mode. It does not scan all historical daily files and does not write daily notes.

## 12. Startup Context Loading

Future session startup can load context in a controlled order:

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Today's and yesterday's daily memory, if enabled
  -> Session resume context
  -> Selected skills
```

MVP should start smaller:

```text
Base system instructions
  -> Project/user configuration
  -> Session resume context
  -> Selected skills
```

Each added prompt file should have tests and trace visibility.

## 13. Memory Write Policy

Memory writes are high-impact because they influence future sessions.

Implemented policy:

- No automatic long-term memory writes in `disabled` or `read-only` mode.
- Session storage writes are allowed as part of normal operation.
- Prompt identity files (`SOUL.md`, `USER.md`, `MEMORY.md`) are always read-only.
- Long-term memory files are not loaded unless the policy is explicitly `read-only` or `write`.
- When policy is `write`, the `append_daily_memory` tool is registered. The model may call it to append a note to `memory/YYYY-MM-DD.md`. Risk level: `medium` — requires user approval in `confirm` mode.
- The `append_daily_memory` tool only writes to today's daily file. It cannot overwrite `MEMORY.md`, `USER.md`, or `SOUL.md`.

Future policy additions:

- Model proposes entries for `MEMORY.md` (curated long-term memory).
- User can approve, edit, or reject proposed memory entries.
- `USER.md` updates require explicit user initiation.
- Memory writes produce trace events.

## 14. Relationship to Permissions

Memory writes should go through permission policy.

Suggested risk levels:

- Session message append: Low
- Trace event append: Low
- Daily note write: Medium
- `MEMORY.md` update: Medium or High depending on content
- `USER.md` update: High
- `SOUL.md` update: High
- Secret-like memory write: Blocked by default

## 15. Relationship to Skills

Skills can guide memory behavior, but cannot write memory directly.

Future memory-related skills may include:

- `memory-curator`
- `daily-notes`
- `user-profile`
- `project-memory`

These skills should propose what to remember. Tools and permissions should control the actual write.

## 16. Testing Requirements

Memory requires strong tests because it changes future behavior.

Required test areas:

- Prompt file loading order
- Missing prompt file behavior
- Session memory reconstruction
- Long-term memory disabled in MVP
- Long-term memory policy validation and display
- Read-only `USER.md` and `MEMORY.md` loading when the policy is enabled
- Read-only today/yesterday daily memory loading when the policy is enabled
- Read-only identity file policy
- Memory write permission classification
- Redaction before memory writes
- Trace events for memory reads and writes
- User approval flow for future durable memory updates

Every memory-related iteration should include tests for both behavior and safety.

## 17. Acceptance Criteria

The MVP memory boundary should be considered successful when:

- Session memory is implemented through session storage.
- Long-term memory is explicitly not auto-written.
- Long-term memory file access has an explicit disabled/read-only policy.
- The design supports future `SOUL.md`, `USER.md`, `MEMORY.md`, and daily memory files.
- Prompt file loading is designed as an explicit context assembly step.
- Identity and memory files cannot bypass permissions.
- The memory plan is documented in both English and Chinese.
- Memory-related behavior has defined tests before implementation.

## 18. Related Documents

- [Main design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Session storage](./session-storage.md)
- [Workspace files](./workspace-files.md)
- [Agent loop](./agent-loop.md)
- [Permission system](./permission-system.md)
- [Skill system](./skill-system.md)

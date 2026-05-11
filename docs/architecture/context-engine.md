# Context Engine

Status: Active
Date: 2026-05-11

Simplified Chinese version: [context-engine.zh-CN.md](./context-engine.zh-CN.md)

## 1. Purpose

The context engine decides how Vole selects, compacts, and projects context into a model run.

Prompt assembly is the first deterministic implementation. The context engine is the longer-term architecture that supports compaction, memory retrieval, workspace file projection, and plugin-provided context.

The core rule:

Prompt assembly builds the request. The context engine decides what context deserves to be in that request.

## 2. Why This Module Exists

As Vole grows, model context will come from many sources:

- Conversation history
- Tool observations
- Execution trace summaries
- Workspace prompt files
- Skills
- Memory files
- Daily notes
- Local knowledge
- Plugin outputs
- Background task state

Without a context engine, these sources compete for model window space in ad hoc ways.

The context engine gives Vole:

- Bounded context
- Predictable ordering
- Compaction strategy
- Memory retrieval strategy
- Trace-visible inclusion decisions
- Future plugin extension point

## 3. MVP Scope

MVP should not implement a full pluggable context engine.

MVP should implement a deterministic context assembler in `packages/context`.

MVP includes:

- Fixed context source ordering
- Session resume context bounds
- Skill index projection
- Tool projection
- Permission guidance projection
- Prompt assembly report
- Redaction before model context

MVP does not include:

- Context engine plugins
- Semantic memory retrieval
- Automatic compaction
- Background context refresh
- Multi-agent context routing

## 4. Future Context Engine Scope

Later phases can expand the context engine to include:

- Context source registry
- Context budget allocation
- Context scoring
- Conversation compaction
- Memory retrieval
- Daily note retrieval
- Workspace file projection
- Plugin-provided context
- Provider-specific context shaping

This should happen only after the deterministic MVP assembler is well tested.

## 5. Context Sources

Potential context sources:

| Source | MVP Status | Notes |
| --- | --- | --- |
| Base system instructions | Included | Always present |
| Runtime metadata | Included | Mode, date, workspace |
| Session messages | Included | Bounded recent turns |
| Tool observations | Included | Summarized |
| Trace summaries | Included | Recent explainable events |
| Skill index | Included | Compact list, not full skill bodies |
| Tool definitions | Included | Provider-neutral projection |
| `AGENTS.md` | Included | Project instructions |
| `SOUL.md` | Included | Read-only identity |
| `USER.md` | Deferred | Needs privacy policy |
| `MEMORY.md` | Deferred | Needs memory write policy |
| Daily notes | Deferred | Needs memory system |
| Plugin context | Deferred | Needs plugin trust model |

## 6. Context Ordering

Context ordering should be deterministic and tested.

MVP order:

```text
Base system instructions
  -> Runtime metadata
  -> Workspace prompt files, if present
  -> Effective configuration
  -> Permission guidance
  -> Skill index
  -> Tool definitions
  -> Session resume context
  -> Recent trace summaries
  -> User message
```

OpenClaw-like future order:

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Recent daily notes, if enabled
  -> Session resume context
  -> Selected skills
  -> Tool definitions
  -> User message
```

The exact order may evolve, but changes must be intentional and tested.

Phase 5 implements the first workspace prompt loading slice. `AGENTS.md` and `SOUL.md` are read from the configured workspace root, skipped when absent, and appended to the system message as structured workspace prompt sections.

## 7. Context Budget

The context engine should eventually manage a context budget.

Budget decisions include:

- How many recent turns to include
- How much tool output to summarize
- Whether to include trace summaries
- Whether to include memory excerpts
- Which skills are relevant
- Whether compaction is needed

MVP can use simple limits, such as recent turns and maximum string sizes.

## 8. Compaction

Compaction converts large context into smaller summaries.

MVP should not implement automatic compaction.

Future compaction should support:

- Conversation summaries
- Tool result summaries
- Trace summaries
- Memory flush before compaction
- User-visible compaction trace events
- Manual compaction commands

Compaction must be tested because it can lose or distort information.

## 9. Memory Retrieval

Memory retrieval should be deferred until the memory policy is ready.

Future retrieval can include:

- `MEMORY.md` excerpts
- Daily note excerpts
- Local knowledge search
- Hybrid lexical/vector retrieval
- User-approved memory promotion

Memory retrieval should be trace-visible and bounded.

## 10. Context Reports

Every context assembly should be able to produce a report.

Report fields:

- Sources considered
- Sources included
- Sources omitted
- Reason for omission
- Size estimates
- Redactions
- Compaction actions
- Memory retrieval actions

The report helps users and developers understand why the model saw certain context.

## 11. Relationship to Prompt Assembly

In MVP, prompt assembly and context assembly may live in the same package.

Conceptually:

- Context engine selects and shapes context.
- Prompt assembly formats selected context into model input.

Keeping this distinction in the design makes future evolution easier.

## 12. Relationship to Session Storage

Session storage is a major context source.

The context engine should read bounded session data through a session interface, not raw files.

Session storage owns persistence. Context engine owns selection.

## 13. Relationship to Memory System

Memory system owns durable memory.

Context engine owns retrieval and projection of memory into a model run.

Memory writes should not happen inside the context engine. They should go through tools, permission policy, and trace.

## 14. Testing Requirements

Context engine behavior needs strong tests.

Required test areas:

- Source ordering
- Context size bounds
- Session resume projection
- Skill index projection
- Tool projection
- Permission guidance projection
- Redaction
- Omitted source reporting
- Future workspace file loading
- Future compaction summaries
- Future memory retrieval bounds

Context tests should be updated whenever prompt assembly, session storage, memory, skills, tools, permissions, or model providers change.

## 15. Acceptance Criteria

MVP context assembly should be considered successful when:

- Context construction is not owned by CLI.
- Context source order is deterministic.
- Session context is bounded.
- Skill index and tool definitions are projected consistently.
- Permission guidance is included.
- Redaction occurs before model context.
- Context assembly produces a report.
- Behavior is covered by unit tests.

## 16. Related Documents

- [Prompt assembly](./prompt-assembly.md)
- [Workspace files](./workspace-files.md)
- [Session storage](./session-storage.md)
- [Memory system](./memory-system.md)
- [Agent loop](./agent-loop.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)
- [Main design](../product/vole-design.md)

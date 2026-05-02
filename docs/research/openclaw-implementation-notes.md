# OpenClaw Implementation Notes

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [openclaw-implementation-notes.zh-CN.md](./openclaw-implementation-notes.zh-CN.md)

## 1. Purpose

This document records what ArvinClaw currently knows about OpenClaw's architecture and implementation.

It separates:

- Facts stated by official OpenClaw documentation
- Repository structure confirmed through the GitHub tree API
- Implementation inferences made from documentation and file names
- ArvinClaw design decisions derived from those findings

This distinction matters because ArvinClaw aims to implement an OpenClaw-like system, not merely imitate surface features.

## 2. Research Status

Current status: preliminary implementation research.

Confirmed sources used:

- OpenClaw official documentation pages
- OpenClaw `llms.txt` documentation index
- OpenClaw GitHub repository tree through the GitHub API

Not yet completed:

- Full local clone analysis
- Line-by-line source reading
- Runtime execution of OpenClaw
- Test suite execution

A shallow clone attempt failed with a GitHub SSL connection error. The current notes therefore treat source-code conclusions as repository-tree confirmations unless a fact is directly stated in official docs.

## 3. Official Documentation Facts

### Agent Loop

OpenClaw documents the agent loop as the authoritative run path:

```text
intake -> context assembly -> model inference -> tool execution -> streaming replies -> persistence
```

Official docs state:

- A loop is a single serialized run per session.
- Entry points include Gateway RPC `agent` / `agent.wait` and CLI `agent`.
- `agent` RPC validates parameters, resolves the session, persists session metadata, and returns `{ runId, acceptedAt }`.
- `agentCommand` resolves model and runtime defaults, loads a skills snapshot, and calls `runEmbeddedPiAgent`.
- `runEmbeddedPiAgent` serializes runs through per-session and global queues.
- `subscribeEmbeddedPiSession` bridges runtime events into OpenClaw streams.
- Event streams include lifecycle, assistant, and tool events.
- Session writes are protected by session write locks.

### Context

OpenClaw documents context as everything sent to the model for a run.

Official docs state context includes:

- OpenClaw-built system prompt
- Conversation history
- Tool calls and tool results
- Attachments and transcripts
- Compaction summaries and pruning artifacts

OpenClaw distinguishes context from memory:

- Context is what fits inside the current model window.
- Memory is stored on disk and can be reloaded later.

### System Prompt

OpenClaw documents that it builds its own system prompt for every agent run.

Official docs state the system prompt includes fixed sections such as:

- Tooling
- Execution Bias
- Safety
- Skills
- OpenClaw Self-Update
- Workspace
- Documentation
- Workspace Files
- Sandbox
- Current Date & Time
- Reply Tags
- Heartbeats
- Runtime
- Reasoning

OpenClaw supports prompt modes:

- `full`
- `minimal`
- `none`

OpenClaw injects workspace bootstrap files under Project Context.

### Workspace Bootstrap Files

Official docs state OpenClaw can inject:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

Daily files under `memory/*.md` are not part of normal bootstrap Project Context. They are accessed through memory tools, except for specific startup/reset cases.

### Agent Workspace

Official docs describe the workspace as the agent's home.

Official docs state:

- Default workspace is `~/.openclaw/workspace`.
- Config, credentials, and sessions live under `~/.openclaw/`, not inside the workspace.
- The workspace is the default working directory, not a hard sandbox.
- Standard workspace files include `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOT.md`, `BOOTSTRAP.md`, `memory/YYYY-MM-DD.md`, `MEMORY.md`, `skills/`, and `canvas/`.
- `skills/` is the highest-precedence workspace-specific skill location.

### Memory

Official docs state OpenClaw remembers by writing Markdown files in the agent workspace.

Official docs describe:

- `MEMORY.md` as long-term memory
- `memory/YYYY-MM-DD.md` as daily notes
- Optional `DREAMS.md` for dreaming summaries and human review
- `memory_search` and `memory_get` tools
- Default memory plugin `memory-core`
- SQLite-based builtin memory backend
- Hybrid search when embeddings are configured
- Automatic memory flush before compaction
- Optional dreaming as a background consolidation pass

## 4. Repository Tree Confirmations

The GitHub tree confirms the repository contains implementation and tests around the documented concepts.

Confirmed paths include:

- `src/agents/agent-command.ts`
- `src/agents/bootstrap-prompt.ts`
- `src/agents/command/session-store.ts`
- `src/agents/command/session.ts`
- `src/agents/memory-search.ts`
- `src/agents/pi-embedded-runner.ts`
- `src/agents/pi-embedded-runner/run.ts`
- `src/agents/pi-embedded-runner/lanes.ts`
- `src/agents/pi-embedded-runner/effective-tool-policy.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/pi-embedded-runner/context-engine-maintenance.ts`
- `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts`
- `extensions/codex/src/app-server/context-engine-projection.ts`
- `extensions/memory-wiki/src/gateway.ts`
- `docs/concepts/agent-loop.md`
- `docs/concepts/context-engine.md`
- `docs/concepts/system-prompt.md`
- `docs/concepts/memory-builtin.md`

The tree also confirms extensive tests near these modules, including tests for:

- Agent command behavior
- Session store behavior
- Context engine projection
- Embedded runner behavior
- Compaction
- Tool policy
- Subagent session spawning
- Memory search
- Gateway behavior
- Security-related CodeQL and workflow checks

## 5. Implementation Inferences

These are inferences, not yet line-level source-confirmed facts.

### Runtime Shape

OpenClaw likely separates:

- Gateway entry and RPC handling
- Agent command orchestration
- Embedded runtime execution
- Session store and transcript persistence
- Prompt/bootstrap construction
- Plugin hooks
- Tool policy and execution control
- Context engine and compaction

This inference is supported by official docs plus repository paths such as `agent-command.ts`, `pi-embedded-runner.ts`, `session-store.ts`, and context-engine files.

### Context Engine

OpenClaw appears to support a default context engine and plugin-provided context engines.

Official docs state that `/compact` and related context assembly can be delegated to an active context engine plugin. Repository paths confirm context-engine-related implementation and tests.

### Skills

OpenClaw injects a compact skills list into the system prompt and expects the model to read `SKILL.md` on demand.

This supports ArvinClaw's current plan to avoid injecting all skill bodies into every model call.

### Memory

OpenClaw's memory system is more advanced than ArvinClaw's MVP plan.

ArvinClaw should not implement OpenClaw's full memory stack immediately. The staged plan should be:

1. Session memory
2. Workspace prompt files
3. Daily notes
4. `MEMORY.md`
5. Memory search
6. Memory promotion/dreaming

## 6. ArvinClaw Design Implications

### Agent Loop

ArvinClaw should model the loop as:

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

This aligns with OpenClaw's documented loop while keeping the MVP smaller.

### Session Serialization

OpenClaw serializes runs per session and protects transcript writes with locks.

ArvinClaw should eventually implement:

- Per-session execution lanes
- Session write locks
- Explicit run IDs
- Wait/status API for runs

MVP can start simpler but should not ignore this design pressure.

### Prompt Assembly

ArvinClaw should make prompt assembly a first-class module.

It should not build prompts ad hoc inside CLI code.

Expected inputs:

- Base system prompt
- Tool descriptions
- Skill index
- Workspace files
- Session context
- Runtime metadata
- Permission policy guidance

### Workspace Files

ArvinClaw should support OpenClaw-like workspace files in stages:

- MVP/Phase 1: `AGENTS.md`
- Phase 1-2: read-only `SOUL.md`
- Phase 5: `USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`
- Later: `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`

### Memory

OpenClaw's memory design confirms that file-based memory is central.

ArvinClaw should keep long-term memory visible, editable, and reviewable instead of hiding it in opaque state.

### Skills

ArvinClaw should keep skill bodies load-on-demand, following OpenClaw's documented approach.

The system prompt should include a compact skill index, not every full skill instruction.

### Hooks

OpenClaw has many hook points. ArvinClaw should defer hooks until tool, permission, trace, and context assembly are stable.

When implemented, hooks need clear decision rules and tests.

## 7. Open Questions for Source-Level Follow-Up

The next research pass should inspect source code for:

- Exact shape of `agentCommand`
- Exact shape of `runEmbeddedPiAgent`
- How `subscribeEmbeddedPiSession` bridges events
- How session write locks are implemented
- How prompt reports are built and persisted
- How bootstrap file truncation is implemented
- How skill eligibility is computed
- How tool policy decisions are enforced
- How context engine plugins are selected
- How memory search and memory flush integrate with compaction

## 8. ArvinClaw Backlog Updates

This research suggests adding or refining these ArvinClaw documents:

- `prompt-assembly.md`
- `context-engine.md`
- `run-queue.md`
- `workspace-files.md`
- `memory-system.md`
- `configuration.md`
- `hooks.md`

It also suggests adding these future test categories:

- Per-session queue serialization
- Session write lock behavior
- Prompt file loading order
- Bootstrap truncation
- Skill index size limits
- Tool policy enforcement
- Context compaction
- Memory flush before compaction

## 9. Sources

- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw Context](https://docs.openclaw.ai/concepts/context)
- [OpenClaw System Prompt](https://docs.openclaw.ai/concepts/system-prompt)
- [OpenClaw Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Context Engine](https://docs.openclaw.ai/concepts/context-engine)
- [OpenClaw Agent Runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)
- [OpenClaw llms.txt](https://docs.openclaw.ai/llms.txt)
- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)

## 10. Related Documents

- [OpenClaw architecture map](../architecture/openclaw-architecture-map.md)
- [Reference systems](../architecture/reference-systems.md)
- [Agent loop](../architecture/agent-loop.md)
- [Run queue](../architecture/run-queue.md)
- [Prompt assembly](../architecture/prompt-assembly.md)
- [Context engine](../architecture/context-engine.md)
- [Memory system](../architecture/memory-system.md)
- [Session storage](../architecture/session-storage.md)

# OpenClaw Implementation Notes

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [openclaw-implementation-notes.zh-CN.md](./openclaw-implementation-notes.zh-CN.md)

## 1. Purpose

This document records what Vole currently knows about OpenClaw's architecture and implementation.

It separates:

- Facts stated by official OpenClaw documentation
- Repository structure confirmed through the GitHub tree API
- Implementation inferences made from documentation and file names
- Vole design decisions derived from those findings

This distinction matters because Vole aims to implement an OpenClaw-like system, not merely imitate surface features.

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

This supports Vole's current plan to avoid injecting all skill bodies into every model call.

### Memory

OpenClaw's memory system is more advanced than Vole's MVP plan.

Vole should not implement OpenClaw's full memory stack immediately. The staged plan should be:

1. Session memory
2. Workspace prompt files
3. Daily notes
4. `MEMORY.md`
5. Memory search
6. Memory promotion/dreaming

## 6. Vole Design Implications

### Agent Loop

Vole should model the loop as:

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

This aligns with OpenClaw's documented loop while keeping the MVP smaller.

### Session Serialization

OpenClaw serializes runs per session and protects transcript writes with locks.

Vole should eventually implement:

- Per-session execution lanes
- Session write locks
- Explicit run IDs
- Wait/status API for runs

MVP can start simpler but should not ignore this design pressure.

### Prompt Assembly

Vole should make prompt assembly a first-class module.

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

Vole should support OpenClaw-like workspace files in stages:

- MVP/Phase 1: `AGENTS.md`
- Phase 1-2: read-only `SOUL.md`
- Phase 5: `USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`
- Later: `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`

### Memory

OpenClaw's memory design confirms that file-based memory is central.

Vole should keep long-term memory visible, editable, and reviewable instead of hiding it in opaque state.

### Skills

Vole should keep skill bodies load-on-demand, following OpenClaw's documented approach.

The system prompt should include a compact skill index, not every full skill instruction.

### Hooks

OpenClaw has many hook points. Vole should defer hooks until tool, permission, trace, and context assembly are stable.

When implemented, hooks need clear decision rules and tests.

## 7. Source-Confirmed Findings (Second Research Pass, 2026-05-04)

These are confirmed from direct repository file access.

### SKILL.md Confirmed Format

The actual standard format from `skills/skill-creator/SKILL.md` and `.agents/skills/`:

```markdown
---
name: skill-name
description: "When to use this skill and what it does."
---
# Skill Title

[Full markdown instructions for the agent — loaded only when the skill is triggered]
```

Only `name` and `description` are required frontmatter fields. `description` serves as both the purpose summary and the routing trigger (what the agent reads to decide if this skill applies). The body is full instructions, loaded on trigger, targeting under 5k words.

Progressive disclosure:
1. Metadata (`name` + `description`) always in context — ~100 words
2. SKILL.md body loaded when skill triggers — target <5k words
3. Bundled resources (`scripts/`, `references/`, `assets/`) loaded as needed by the agent

Vole implication: Our `ContextSkillSummary.when` field is non-standard. The correct approach is a single `description` field that answers both "what does this do" and "when to use it". The `when` field should be removed and its content merged into `description`.

### OpenClaw Tasks and TaskFlow (vs Claude Code TodoWrite)

OpenClaw has a full task registry in `src/tasks/` with SQLite persistence. This is completely different from Claude Code's TodoWrite.

**OpenClaw Tasks** (`task-registry.types.ts`):
```typescript
type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "lost";
type TaskRecord = {
  taskId: string;
  runtime: "subagent" | "acp" | "cli" | "cron";
  task: string;
  status: TaskStatus;
  progressSummary?: string;
  terminalSummary?: string;
};
```

**OpenClaw TaskFlow** (`task-flow-registry.types.ts`) — durable multi-step pipelines:
- Fields: `goal`, `currentStep`, `blockedSummary`, `stateJson`
- Statuses: `queued | running | waiting | blocked | succeeded | failed | cancelled | lost`
- Two modes: `managed` (TaskFlow drives steps) and `mirrored` (observes external tasks)
- Full parent/child task relationships for multi-agent coordination

**Claude Code TodoWrite** (confirmed from Agent SDK docs):
- A tool the model calls directly (not infrastructure-level)
- Ephemeral: exists only within one agent turn's context
- Replace-all list: `{ todos: Array<{ content, status: "pending"|"in_progress"|"completed", activeForm }> }`
- No `TodoRead` — consumers watch the stream for `TodoWrite` tool calls
- Purpose: in-turn progress display to the user

**Comparison**:

| | Vole Plan | Claude Code TodoWrite | OpenClaw TaskFlow |
| --- | --- | --- | --- |
| Storage | In-memory (one turn) | In-context (one turn) | SQLite (persistent) |
| Lifecycle | Created at turn start | Model calls on demand | Durable across sessions |
| Driven by | AgentRuntime (infra) | Model (tool call) | TaskFlow engine (infra) |
| Status states | pending/running/complete/failed/skipped | pending/in_progress/completed | 7 states incl. blocked/lost |
| Multi-agent | No | No | Yes (parent/child) |
| Purpose | Decompose goal into steps | Show progress to user | Background job orchestration |

**Vole implication**: The pre-execution `Plan` construct (infra-driven step execution) has been removed. The correct approach is a model-called `update_todos` tool equivalent — confirmed by the Third Research Pass (Section 8). TaskFlow-equivalent persistence (SQLite, cross-session) belongs to Phase 8+.

### `pi-embedded-runner` Execution Lanes

Confirmed: `pi-embedded-runner/lanes.ts` handles session vs. global command lanes (`session:<key>` naming), not task/plan tracking. Plan state management (`buildAgentRuntimePlan`, `emitAgentPlanEvent`) is in `run.ts` — internal to the embedded runner, not user-visible todos.

## 8. Source-Confirmed Findings (Third Research Pass, 2026-05-04)

These are confirmed from direct repository file access and documentation fetch.

### `update_plan` Tool — Per-Turn Progress Tracker

Source: `src/agents/tools/update-plan-tool.ts`, test at `src/agents/openclaw-tools.update-plan.test.ts`.

OpenClaw has a model-callable tool to track task progress during execution. Schema:

```typescript
plan: Array<{
  step: string;
  status: "pending" | "in_progress" | "completed"
}>
```

At most one step may be `in_progress` at a time. The model replaces the entire list on each call (same pattern as Claude Code's `TodoWrite`).

**Gating rules:**
- Disabled by default — requires `tools.experimental.planTool: true` in config.
- Auto-enabled for GPT-5 / GPT-5.5+ models when `executionContract` is unset or `strict-agentic`.
- **Not** auto-enabled for Anthropic Claude — must be explicitly opted in.
- Explicit `tools.experimental.planTool: false` disables it even under `strict-agentic`.

**Key distinction from the removed Vole Plan:** The model calls `update_plan` *during* execution to track what it has done — not *before* execution to generate a plan for the runtime to orchestrate. The tool carries no infra-side execution management.

**Relationship to Claude Code TodoWrite:** Structurally identical — both are model-called, full-replace, `pending/in_progress/completed` status lists. OpenClaw's `update_plan` is its native equivalent of Claude Code's `TodoWrite`.

Vole implication: Implement an `update_todos` tool following this model-called pattern. No infra orchestration needed.

### Planning Stall Detection

Source: `src/agents/pi-embedded-runner/run/incomplete-turn.ts`.

OpenClaw actively detects when the model produces planning text without taking a tool action and forces correction. Detection uses three regex patterns:

- `PLANNING_ONLY_PROMISE_RE` — matches "I'll...", "let me...", "I'm going to..."
- `PLANNING_ONLY_HEADING_RE` — matches headings like "Plan:", "Steps:", "Approach:"
- `PLANNING_ONLY_BULLET_RE` — matches bulleted or numbered step lists

On detection, the runner injects:
```
PLANNING_ONLY_RETRY_INSTRUCTION = "The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can."
```

If the model keeps producing planning-only turns without acting, the run terminates:
```
STRICT_AGENTIC_BLOCKED_TEXT = "Agent stopped after repeated plan-only turns without taking a concrete action."
```

Retry limits:
- Default: 1 planning-only retry before termination.
- `executionContract: "strict-agentic"`: 2 retries before hard stop.

Vole implication: This is a high-value mechanism to add in Phase 4. Without it, the model may narrate plans indefinitely without acting. The check should live in `AgentRuntime` after each model response before tool dispatch.

### `sessions_spawn` — Subagent System

Source: `https://docs.openclaw.ai/tools/subagents`, `docs/tools/subagents.md`.

This is OpenClaw's primary mechanism for long-horizon task decomposition and parallel work:

- Main agent calls `sessions_spawn` to launch background subagents.
- Each subagent runs in its own session (`agent:<id>:subagent:<uuid>`) with isolated context.
- Completion is push-based — subagents announce results to the parent when done; no polling.
- Supports orchestrator pattern: main → orchestrator subagent → worker subagents (max depth 2).
- Default max concurrent subagents: 8 globally, 5 per parent session.
- Context modes: `isolated` (default — fresh context, cheaper) or `fork` (branches parent transcript).

Available by default in `coding` and `full` tool profiles; not in `messaging`.

Vole implication: Subagents are Phase 7+ work requiring a gateway and multi-session infrastructure. Do not implement in earlier phases.

### `strict-agentic` Execution Contract

Sets stricter in-turn execution behavior:
- Auto-enables `update_plan` for supported models (not Anthropic by default).
- Increases planning-only retry limit from 1 to 2 before hard stop.
- Enforces tighter anti-stall behavior throughout the run.

### Thinking Budget

OpenClaw exposes a configurable reasoning budget: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `adaptive`, `max`.

- Anthropic Claude 4.6 defaults to `adaptive`.
- Thinking happens inside the model before tool calls — not a separate pre-planning pass.
- Controlled via `/think:<level>` inline directive, session default, or per-agent config.

Vole implication: Defer. Anthropic models handle this internally. No config surface needed until Phase 9+.

## 9. Open Questions for Source-Level Follow-Up

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

## 10. Vole Backlog Updates

This research suggests adding or refining these Vole documents:

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

## 11. Sources

- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw Context](https://docs.openclaw.ai/concepts/context)
- [OpenClaw System Prompt](https://docs.openclaw.ai/concepts/system-prompt)
- [OpenClaw Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Context Engine](https://docs.openclaw.ai/concepts/context-engine)
- [OpenClaw Agent Runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)
- [OpenClaw llms.txt](https://docs.openclaw.ai/llms.txt)
- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)

## 12. Related Documents

- [OpenClaw architecture map](../architecture/openclaw-architecture-map.md)
- [Reference systems](../architecture/reference-systems.md)
- [Agent loop](../architecture/agent-loop.md)
- [Run queue](../architecture/run-queue.md)
- [Prompt assembly](../architecture/prompt-assembly.md)
- [Context engine](../architecture/context-engine.md)
- [Memory system](../architecture/memory-system.md)
- [Session storage](../architecture/session-storage.md)

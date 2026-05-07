# OpenClaw Alignment Plan

Status: Complete
Date: 2026-05-05

Simplified Chinese version: [openclaw-alignment.zh-CN.md](./openclaw-alignment.zh-CN.md)

## 1. Purpose

Phases 0–10 established Vole as a working personal agent platform aligned with OpenClaw's core architecture.

This document tracked the remaining gaps between Vole and OpenClaw's production behavior across Iterations 1–7. All 18 gaps are now closed.

This document is archived. New architectural gaps or improvements should be tracked in a successor roadmap document.

## 2. Gap Summary

| # | Gap | Priority | Iteration | Status | Commit |
|---|---|---|---|---|---|
| 1 | Context compaction | 🔴 High | 1 | ✅ Complete | `df54b1e` |
| 2 | Skill body on-demand loading (`load_skill` tool) | 🔴 High | 1 | ✅ Complete | `10167ac` |
| 3 | Prompt modes (full / minimal / none) | 🟡 Medium | 1 | ✅ Complete | `2e8251c` |
| 4 | `memory_search` tool | 🔴 High | 2 | ✅ Complete | `a7a1c5d` |
| 5 | `memory_get` tool | 🟡 Medium | 2 | ✅ Complete | `a7a1c5d` |
| 6 | Additional workspace files (TOOLS.md, IDENTITY.md, HEARTBEAT.md, BOOTSTRAP.md) | 🟡 Medium | 2 | ✅ Complete | `fee903d` |
| 7 | Heartbeat mechanism | 🟡 Medium | 2 | ✅ Complete | `fee903d` |
| 8 | Strict-agentic execution contract | 🟡 Medium | 3 | ✅ Complete | `c9d47f9` |
| 9 | Per-session write locks (run serialization) | 🟡 Medium | 3 | ✅ Complete | `eb555f5` |
| 10 | Hooks system | 🟡 Medium | 3 | ✅ Complete | `eb555f5` |
| 11 | Tool profiles (coding / full / messaging / background) | 🟡 Medium | 4 | ✅ Complete | `5021b64` |
| 12 | Sandbox enforcement (workspace-boundary shell) | 🟡 Medium | 4 | ✅ Complete | `68befac` |
| 13 | Cron daemon (`vole daemon`) | 🟡 Medium | 5 | ✅ Complete | `6f47106` |
| 14 | TaskFlow (persistent cross-session task graph) | 🟢 Low | 6 | ✅ Complete | `ebcd52b` |
| 15 | Async subagents (push-based, fork context mode) | 🟢 Low | 6 | ✅ Complete | `a7b1fc2` |
| 16 | WebSocket support | 🟢 Low | 7 | ✅ Complete | `ee000d4` |
| 17 | Thinking budget configuration | 🟢 Low | 7 | ✅ Complete | `8967c2e` |
| 18 | Memory dreaming / promotion | 🟢 Low | 7 | ✅ Complete | `cee3327` |

## 3. Iteration 1 — Context and Prompt

**Goal**: Stop wasting context window tokens and enable prompt mode selection.

### Gap 1: Context Compaction

Long conversations overflow the model's context window. Vole currently passes all messages on every turn without any management.

OpenClaw solution: `context-engine-maintenance.ts` summarizes old messages using the model when the context exceeds a threshold. The summary replaces old messages and is injected as a system message.

Vole design:
- Add `compactMessages(messages, modelProvider, options)` to `packages/context`
- `CompactionOptions`: `maxMessages` (default 30), `keepRecent` (default 12), `summarySystemPrompt`
- `AgentRuntimeDependencies.compaction?: Partial<CompactionOptions>` — opt-in
- Called in `runTurn()` before each model request when message count exceeds threshold
- Fail-safe: if the summary call fails, use original messages unchanged

Architecture doc: [context-compaction.md](../architecture/context-compaction.md)

### Gap 2: Skill Body On-Demand Loading

Vole currently injects full SKILL.md content into every prompt. With many skills, this wastes tokens on content the model may not need.

OpenClaw solution: inject only the compact skill index (name + description). The model calls a `load_skill(name)` tool when it needs a skill's full instructions.

Vole design:
- Add `createLoadSkillTool(skillFileMap: Map<string, string>)` to `packages/tools`
- `skillFileMap` maps skill name → absolute file path (already available via `SkillDefinition.filePath`)
- Tool risk: low. Returns file content or an error.
- CLI and Web wire the tool alongside other built-in tools when skills are loaded
- Context assembly stops injecting skill bodies; only the index (name + description) goes in the prompt

Architecture doc: [skill-system.md](../architecture/skill-system.md) (update)

### Gap 3: Prompt Modes

OpenClaw supports three prompt rendering modes. Vole always renders all sections.

Vole design:
- Add `promptMode: "full" | "minimal" | "none"` to `ContextAssemblerInput` in `packages/context`
- `none`: send no system instruction at all
- `minimal`: include identity section only
- `full`: all sections (current behavior, remain default)
- Surface as `VOLE_PROMPT_MODE` env var and `runtime.promptMode` config field

Architecture doc: [execution-contract.md](../architecture/execution-contract.md)

## 4. Iteration 2 — Memory

**Goal**: Give the agent tools to actively search and retrieve its own memory.

### Gap 4: `memory_search` Tool

The agent cannot currently query its memory. Long-term memory is passively loaded into context but not actively searchable.

OpenClaw solution: `memory_search` tool performs full-text search over memory files, returning relevant excerpts.

Vole design:
- Add `createMemorySearchTool(memoryDir: string)` to `packages/tools`
- Input: `{ query: string, maxResults?: number }` (default 5 results)
- Searches all `.md` files in `memoryDir`, splits into paragraphs, returns paragraphs containing query words
- Returns `{ results: Array<{ file: string, excerpt: string }> }`
- Tool risk: low
- Enabled when `config.memory.longTermFiles` is `read-only` or `write`

Architecture doc: [memory-system.md](../architecture/memory-system.md) (update)

### Gap 5: `memory_get` Tool

The agent cannot read a specific memory file by name.

Vole design:
- Add `createMemoryGetTool(memoryDir: string)` to `packages/tools`
- Input: `{ filename: string }` — e.g. `"MEMORY.md"` or `"memory/2026-05-05.md"`
- Validates filename: no `..` traversal, must end in `.md`
- Returns file content or an error message
- Tool risk: low

### Gap 6: Additional Workspace Files

OpenClaw loads `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md` as bootstrap files. Vole currently loads only `AGENTS.md` and `SOUL.md`.

Vole design:
- Add `TOOLS.md` and `IDENTITY.md` to the `workspacePromptFiles` list in `createCliContextAssembler`
- `TOOLS.md`: loaded when present — describes agent's tool configuration notes
- `IDENTITY.md`: loaded when present — overrides/extends agent identity
- `BOOTSTRAP.md`: loaded when present on first session — one-time setup instructions
- `HEARTBEAT.md`: read + written by the agent for heartbeat state (see Gap 7)

### Gap 7: Heartbeat Mechanism

OpenClaw supports a periodic heartbeat via `HEARTBEAT.md` that allows background monitoring.

Vole design (minimal version):
- `HEARTBEAT.md` in workspace is loaded if present (bootstrap context)
- The agent can write heartbeat updates via `write_file` to this path
- A dedicated `update_heartbeat` tool can be added later for richer semantics
- Full daemon heartbeat loop is part of the cron daemon (Iteration 5)

## 5. Iteration 3 — Execution

**Goal**: Tighter execution discipline, concurrency safety, and extensibility hooks.

### Gap 8: Strict-Agentic Execution Contract

OpenClaw's `strict-agentic` execution contract increases stall detection strictness and enables `update_plan` for compatible models.

Vole design:
- Add `executionContract: "default" | "strict-agentic"` to `AgentRuntimeDependencies`
- `strict-agentic` behavior:
  - `maxPlanningStallRetries` defaults to 3 instead of 2
  - `update_todos` is promoted in the system prompt as the primary progress mechanism
- Surface via `VOLE_EXECUTION_CONTRACT` env var and config

Architecture doc: [execution-contract.md](../architecture/execution-contract.md)

### Gap 9: Per-Session Write Locks

Concurrent `runTurn()` calls for the same session can race on JSONL writes and produce interleaved trace/message records.

Vole design:
- Add `SessionMutex` class to `packages/core` or `packages/sessions`
- `async acquire(sessionId): Promise<() => void>` — returns a release function
- `AgentRuntime` acquires the session lock before starting a turn, releases on completion
- Adapters that create runtimes are expected to pass session IDs consistently

Architecture doc: [run-queue.md](../architecture/run-queue.md) (update)

### Gap 10: Hooks System

OpenClaw exposes multiple hook points for extensions. Vole has no hooks.

Vole design:
- Add `AgentHooks` interface to `packages/core`:
  ```ts
  export interface AgentHooks {
    beforeTurn?: (input: AgentRuntimeInput) => Promise<void>;
    afterTurn?: (events: RuntimeEvent[]) => Promise<void>;
    beforeToolCall?: (call: ModelToolCall) => Promise<void | "abort">;
    afterToolCall?: (call: ModelToolCall, result: ToolExecutionResult) => Promise<void>;
    onCompaction?: (before: number, after: number) => Promise<void>;
  }
  ```
- Add `hooks?: AgentHooks` to `AgentRuntimeDependencies`
- Hooks are called at the appropriate points in `runTurn()`
- Hook errors are logged to trace but do not fail the run
- `beforeToolCall` returning `"abort"` prevents the tool call from executing

Architecture doc: [hooks.md](../architecture/hooks.md)

## 6. Iteration 4 — Tool System

**Goal**: Structured tool capability sets and runtime boundary enforcement.

### Gap 11: Tool Profiles

OpenClaw provides tool profiles (`coding`, `full`, `messaging`) that determine which tools are available in a session.

Vole design:
- Add `ToolProfile` type to `packages/adapters` or `packages/tools`
- Profiles: `coding` (file + shell), `full` (all tools), `messaging` (no file/shell), `background` (file only)
- `getToolsForProfile(profile, allTools)` returns the subset of tools for that profile
- CLI: default `full`; background tasks: default `background`
- Configurable via `VOLE_TOOL_PROFILE` env var

Architecture doc: [tool-profiles.md](../architecture/tool-profiles.md)

### Gap 12: Sandbox Enforcement

The shell tool has no runtime boundary. A model can execute commands anywhere on the filesystem.

Vole design:
- Add `sandboxed?: boolean` option to shell tool config
- When `sandboxed: true`: set `cwd` to `workspaceRoot`, reject paths starting with `..` or `/` outside workspace
- `memory_get` already validates path traversal
- Promote sandbox enforcement in the "Sandbox" system prompt section (currently only textual)

Architecture doc: [sandboxing.md](../architecture/sandboxing.md) (update)

## 7. Iteration 5 — Background Automation

**Goal**: Scheduled execution without a foreground session.

### Gap 13: Cron Daemon

`vole run` executes one task. There is no recurring scheduler.

Vole design:
- `vole daemon` command — starts a long-running process
- Reads task definitions from `tasks/*.task.json` in the workspace
- Each task file can include a `cron` field (cron expression, e.g. `"0 18 * * *"`)
- Daemon evaluates next-run times and executes tasks when due
- Uses `BackgroundApprovalResolver` for unattended execution
- Persists run records in `JsonlTaskStore`
- Signal-safe: `SIGTERM` / `SIGINT` gracefully stop in-progress tasks

Architecture doc: [background-automation.md](../architecture/background-automation.md) (update)

## 8. Iteration 6 — Multi-Agent

**Goal**: Persistent task coordination and non-blocking sub-agent execution.

### Gap 14: TaskFlow

`update_todos` tracks progress within a single turn. There is no persistent cross-session task graph.

OpenClaw has `TaskRecord` and `TaskFlow` with 7 statuses, parent/child relationships, and SQLite persistence.

Vole design:
- `packages/taskflow` — new package
- `TaskRecord`: `{ id, runtime, task, status, progressSummary, terminalSummary }`
- `TaskFlow`: `{ id, goal, currentStep, blockedSummary, stateJson, parentId?, status }`
- Status: `queued | running | waiting | blocked | succeeded | failed | cancelled | lost`
- Storage: JSONL initially, SQLite in a later iteration
- CLI commands: `vole taskflow list`, `vole taskflow show <id>`, `vole taskflow cancel <id>`

Architecture doc: [task-flow.md](../architecture/task-flow.md)

### Gap 15: Async Subagents

`spawn_subagent` currently runs synchronously — the parent agent blocks until the sub-agent completes.

OpenClaw `sessions_spawn` is push-based: the main agent continues while sub-agents run in parallel, and results are delivered asynchronously.

Vole design:
- Add `spawn_subagent_async` tool variant that starts the sub-agent in a background task
- Returns a `{ taskId }` immediately
- The sub-agent's result is written to `TaskRecord` when complete
- Parent agent can use `check_subagent(taskId)` to poll or receive a completion callback
- Context mode: `isolated` (fresh context — current behavior) + `fork` (copy parent transcript)

Architecture doc: [multi-agent-runtime.md](../architecture/multi-agent-runtime.md) (update)

## 9. Iteration 7 — Protocol and Advanced

**Goal**: Richer transport support, model reasoning control, and memory lifecycle management.

### Gap 16: WebSocket Support

The Web adapter uses SSE (server-sent events), which is unidirectional. WebSocket enables bidirectional communication and is better suited for approval flows and cancellation.

Vole design:
- Add WebSocket endpoint to Hono server: `GET /ws/:sessionId`
- Server sends runtime events as JSON frames
- Client sends user messages and approval decisions as JSON frames
- SSE endpoint remains available for compatibility
- Implement using Hono's WebSocket upgrade support

Architecture doc: [gateway.md](../architecture/gateway.md) (update)

### Gap 17: Thinking Budget

OpenClaw exposes configurable reasoning depth for Anthropic models.

Vole design:
- Add `thinkingBudget?: "off" | "minimal" | "low" | "medium" | "high" | "max" | "adaptive"` to model config
- `AnthropicProvider` maps budget to the Anthropic extended thinking API parameters
- Only relevant for Anthropic models that support extended thinking
- Default: `"adaptive"` (model decides)

Architecture doc: [execution-contract.md](../architecture/execution-contract.md) (update)

### Gap 18: Memory Dreaming

OpenClaw supports background memory consolidation: the agent reviews recent daily notes and promotes key facts to `MEMORY.md`.

Vole design:
- Dreaming is a special background task type: `vole run --dream`
- Reads recent `memory/YYYY-MM-DD.md` files and `MEMORY.md`
- Produces a consolidated summary and appends to or rewrites `MEMORY.md`
- Can be scheduled via cron daemon
- All writes subject to `memory.longTermFiles: "write"` policy

Architecture doc: [memory-system.md](../architecture/memory-system.md) (update)

## 10. Non-Goals

- No guarantee of full parity with OpenClaw's internal implementation
- No enterprise SaaS assumptions
- No automatic trust of third-party code
- No cloud synchronization of memory or sessions
- No multi-user account system

## 11. Related Documents

- [Research: OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Architecture: OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)
- [Decision: OpenClaw-Aligned, Not Identical](../decisions/0002-openclaw-aligned-not-identical.md)
- [Roadmap](../roadmap/overview.md)

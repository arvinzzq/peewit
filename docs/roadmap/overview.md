# Vole Roadmap

Status: Active
Date: 2026-05-11

Simplified Chinese version: [overview.zh-CN.md](./overview.zh-CN.md)

## 1. Roadmap Principle

Vole should evolve through usable product milestones, not isolated technical experiments.

Reference systems: [Reference Systems](../architecture/reference-systems.md)

OpenClaw architecture map: [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)

Each phase should produce:

- A user-visible capability
- A clearer architecture boundary
- Learning documentation for the new modules
- Tests that protect the new behavior and module contracts
- Acceptance criteria that can be verified
- Explicit non-goals to prevent scope creep

The roadmap follows a dual-track approach:

- Product track: every phase should make Vole more useful.
- Learning track: every phase should explain the agent architecture it introduces.
- Quality track: every phase should add or update tests for the behavior it introduces.

## 2. Phase Summary

| Phase | Status | Goal | Product Result | Architecture Focus |
| --- | --- | --- | --- | --- |
| Phase 0 | Complete | Project foundation | A documented TypeScript workspace with CLI shell | Monorepo, config, context package, documentation layout |
| Phase 1 | Complete | MVP agent loop | CLI chat can call a model and produce traceable responses | Agent Core, context assembly, ModelProvider, basic loop |
| Phase 2 | Complete | Tools and permissions | Agent can inspect files, run approved commands, and read web content | Tool Registry, PermissionPolicy |
| Phase 3 | Complete | Context assembly and skills | Agent has structured context with tools, skills, and permission guidance; can load `SKILL.md`; Claude available directly | Context section architecture, Anthropic provider, skill loader |
| Phase 4 | Complete | In-turn task tracking | Agent tracks complex task progress transparently and avoids planning stalls | `update_todos` tool, planning stall detection |
| Phase 5 | Complete | Sessions and memory | Agent remembers sessions and can use local knowledge | Session store, trace store, memory interfaces |
| Phase 6 | Complete | Streaming and Web UI | Token-by-token streaming in CLI; browser-based chat with trace and approvals | Streaming ModelProvider, Ink CLI, Web adapter, SSE |
| Phase 7 | Complete | Multi-entry adapters | CLI, Web, desktop, and message entries share one Agent Core | Adapter interface, gateway direction |
| Phase 8 | Complete | Background automation | Agent can run scheduled and event-triggered tasks | Scheduler, daemon, task queue |
| Phase 9 | Complete | Plugin and skill ecosystem | User can install, enable, disable, and review capabilities | Plugin metadata, permission declarations, versioning |
| Phase 10 | Complete | Full personal agent platform | OpenClaw-like personal agent with multiple models, agents, nodes, and sandboxed tools | Gateway, multi-agent runtime, node protocol, sandboxing |
| Phase 11 | Complete | Gateway and lanes | Cross-process safe runtime infrastructure | GatewayCore, LaneRegistry, session key naming, file lock |
| Phase 12 | Complete | Multi-agent runtime maturity | Push-completion sub-agents with fork mode, depth and concurrency policy | Sub-agent push announce, fork context, sub-agent management surface |
| Phase 13 | Complete | Memory and prompt enhancement | All 8 steps shipped (Steps 3, 4, 5, 6 landed in 13b) | hybrid memory_search via FakeEmbeddingProvider + RRF, DREAMS.md review workflow, pre-compaction memory_flush_triggered, six new system prompt sections |
| Phase 14 | Complete | SQLite storage unification | All 8 steps shipped (Steps 5, 6, 7 landed in 14b) | SQLite stores, SqliteMemoryIndex (FTS5), vole migrate jsonl-to-sqlite, startup migration hint |
| Phase 15 | Partial | Channels and multi-agent identity | per-agent identity + `vole agents` + channel↔submitter bridge shipped; Telegram + Email backends still need external infra | agents/<id>/ identity, vole agents CLI, channel bridge, Telegram (deferred), Email (deferred) |
| Phase 16 | Complete | Sandbox and plugin runtime | All 7 steps shipped (Steps 3, 4, 6 landed in 16b) | SandboxBackend, WorkspaceSandbox, WorkerThreadSandbox, DockerSandbox, vole doctor + --fix |

Some later-phase learning documents are listed as planned filenames before they exist. They should be created when that phase is being actively designed, not all at once during MVP setup.

Phases 11–16 are planned. Each has a detailed plan document under `docs/plans/phase-NN-*.md`; sections 15–20 below summarize them at a glance.

Progress detail lives in the phase plan documents. Roadmap status should stay high level and should be updated when a phase starts, completes, or materially changes scope.

## 3. Phase 0: Project Foundation

### User Result

The user can inspect a clean project structure and understand the intended architecture before implementation begins.

### Architecture Added

- Lightweight monorepo structure
- CLI app boundary
- Package boundaries for core, config, models, tools, skills, permissions, and sessions
- Context package boundary for prompt and context assembly
- Configuration file conventions
- Documentation structure

### Learning Documents

- `docs/roadmap/overview.md`
- `docs/architecture/project-structure.md`
- `docs/architecture/configuration-system.md`
- Main design document under `docs/product/`

Primary architecture note: [Project Structure](../architecture/project-structure.md)

Supporting architecture note: [Configuration System](../architecture/configuration-system.md)

### Acceptance Criteria

- Repository contains the agreed monorepo directory layout.
- Project has a root README that explains what Vole is.
- Main design document links to the roadmap.
- Architecture documentation explains why Agent Core is separate from CLI.

### Non-Goals

- No complete agent loop yet.
- No Web UI.
- No plugin marketplace.
- No background automation.

## 4. Phase 1: MVP Agent Loop

### User Result

The user can start `vole chat`, send a message, receive a model response, and see an explainable trace of the interaction.

### Architecture Added

- Agent Core
- Context assembly package
- `ModelProvider` interface
- OpenAI-compatible model provider
- Basic agent loop
- Execution trace model
- CLI chat adapter

### Learning Documents

- `docs/architecture/agent-loop.md`
- `docs/architecture/model-provider.md`
- `docs/architecture/execution-trace.md`
- `docs/architecture/cli-adapter.md`
- `docs/plans/phase-1-mvp-test-guide.md`

Primary architecture note: [Agent Loop](../architecture/agent-loop.md)

Supporting architecture note: [Model Provider](../architecture/model-provider.md)

Supporting architecture note: [Execution Trace](../architecture/execution-trace.md)

Supporting architecture note: [CLI Adapter](../architecture/cli-adapter.md)

User verification guide: [Phase 1 MVP Test Guide](../plans/phase-1-mvp-test-guide.md)

### Acceptance Criteria

- `vole chat` starts an interactive session.
- The CLI can call an OpenAI-compatible model provider.
- The Agent Core does not import CLI-specific code.
- Each response produces a trace entry.
- Model configuration can be loaded from config files and environment variables. File-based config auto-loading (`~/.vole/config.json` user-level and `vole.config.json` project-level) is implemented.
- Missing API keys produce a clear CLI error.
- Fake-provider paths remain available for local learning and tests.

### Non-Goals

- No complex planning.
- No long-term memory.
- No Web UI.
- No multi-agent runtime.

### OpenClaw Gap After Phase 1

Phase 1 intentionally stops before persistent sessions, workspace prompt loading, memory files, tools, permissions, skills, channels, heartbeat, and multi-agent behavior.

The next OpenClaw-aligned increment should add session storage and short-term memory before broader tools or channels.

## 5. Phase 2: Tools and Permissions

### User Result

The agent can use basic tools safely:

- Read files inside the workspace
- List directories
- Write files after confirmation
- Execute shell commands after explicit confirmation
- Search or read web content through configured providers

### Architecture Added

- Tool interface
- Tool registry
- Tool result schema
- Risk classification
- Permission policy
- Permission prompts in CLI

### Learning Documents

- `docs/architecture/tool-system.md`
- `docs/architecture/permission-system.md`

Primary architecture note: [Tool System](../architecture/tool-system.md)

Supporting architecture note: [Permission System](../architecture/permission-system.md)

Implementation plan: [Phase 2 Tools and Permissions](../plans/phase-2-tools-and-permissions.md)

### Acceptance Criteria

- Tools can be registered without changing Agent Core logic.
- Low-risk actions can run automatically in `confirm` mode.
- Medium and High risk actions require confirmation.
- Blocked actions are denied unless explicitly configured.
- Tool calls and permission decisions appear in the execution trace.

### Non-Goals

- No full sandbox.
- No browser automation.
- No remote tool nodes.

## 6. Phase 3: Context Assembly and Skills

### User Result

The agent's system prompt has structured sections for identity, runtime, tooling, safety, skills, and workspace. The model knows what tools are available through a tooling section. The agent can load local skills and use them to guide behavior. Claude can be used directly via Anthropic API.

### Architecture Added

- Section-based context assembly (`ContextToolSummary`, `ContextSkillSummary`, named sections)
- Tool summaries flowing from `AgentRuntime` through context assembler into system prompt
- Permission guidance section in system prompt
- Anthropic provider
- Skill directory scanner
- `SKILL.md` parser
- Skill precedence rules: workspace > user > built-in
- Built-in skills
- Skill index injected into context

### Learning Documents

- `docs/architecture/skill-system.md`
- `docs/decisions/0005-anthropic-provider.md`

Primary architecture note: [Skill System](../architecture/skill-system.md)

Supporting decision: [Anthropic Provider](../decisions/0005-anthropic-provider.md)

Implementation plan: [Phase 3 Context Assembly and Skills](../plans/phase-3-context-assembly-and-skills.md)

### Acceptance Criteria

- Context assembler includes tooling, safety, and skills sections when relevant inputs are provided.
- Tool descriptions appear in system prompt.
- Skills can load from project, user, and built-in locations.
- Project skills override user and built-in skills with the same name.
- The CLI can list loaded skills with `/skills`.
- Skills influence agent behavior through system prompt without bypassing Tool and Permission systems.
- Anthropic provider selectable via `model.provider: "anthropic"`.

### Non-Goals

- No remote skill installation.
- No public marketplace.
- No skill version manager.
- No arbitrary permission grant from skill files.
- No context compaction.
- No streaming output.

## 7. Phase 4: In-Turn Task Tracking

### User Result

The agent tracks complex task progress transparently during execution. The user can see which steps have been done and what is next. The agent does not stall by narrating plans without taking action.

### Architecture Added

- `update_todos` tool: model-called tool for per-turn task tracking (equivalent to OpenClaw `update_plan` and Claude Code `TodoWrite`)
- Planning stall detection in `AgentRuntime`: detect plan-only turns and inject retry instruction
- CLI progress display: show current todo state after each turn

### Design Alignment

OpenClaw's approach (confirmed from source, 2026-05-04):

1. **`update_plan` tool** — model calls it during execution to update step statuses. Not a pre-execution planner. Full-replace list: `{step, status: pending|in_progress|completed}[]`.
2. **Planning stall detection** — runtime detects "I'll...", bulleted plans, step headings without tool actions, and injects a retry instruction forcing immediate execution.
3. **Execute-first, not plan-first** — the model acts immediately and updates the plan state as it goes.

Vole's `update_todos` follows the same model-called, no-infra-orchestration pattern.

### Learning Documents

- `docs/plans/phase-4-in-turn-task-tracking.md`
- `docs/research/openclaw-implementation-notes.md` Section 8

### Acceptance Criteria

- Model can call `update_todos` to declare and update task steps with `pending`, `in_progress`, or `completed` status.
- CLI displays the current todo list after each turn when the model updates it.
- `AgentRuntime` detects plan-only turns (no tool calls, planning-pattern text) and injects a retry instruction.
- After `N` consecutive plan-only turns, the run terminates with a clear error message.
- `update_todos` is registered as a standard tool; no infra orchestration added.

### Non-Goals

- No infra-driven step execution (execute-first is the correct pattern).
- No subagent spawning (Phase 7+).
- No SQLite-backed persistent TaskFlow (Phase 8+).
- No pre-execution planner that blocks execution until a plan is approved.

## 8. Phase 5: Sessions, Memory, and Knowledge

### User Result

The agent can preserve session history, show previous traces, and begin using local knowledge across tasks.

### Architecture Added

- Session store
- Trace store
- Memory interface
- Local knowledge retrieval interface

### Learning Documents

- `docs/architecture/session-storage.md`
- `docs/architecture/memory-system.md`
- `docs/architecture/local-knowledge.md`
- `docs/plans/phase-5-sessions-and-memory.md`

`local-knowledge.md` is planned and has not been created yet.

Primary architecture note: [Session Storage](../architecture/session-storage.md)

Supporting architecture note: [Memory System](../architecture/memory-system.md)

Implementation plan: [Phase 5 Sessions and Memory](../plans/phase-5-sessions-and-memory.md)

### Acceptance Criteria

- Sessions can be saved and resumed.
- Traces can be inspected after a session ends.
- Memory is separated from raw chat history.
- The agent can use recent session history in context.
- The first memory implementation can be replaced later.
- Project-scoped sessions are implemented: the CLI detects the git repository root at startup and stores sessions under `<git-root>/.vole/sessions/`, falling back to `~/.vole/sessions/` when no git root is found.

### Non-Goals

- No cloud sync.
- No multi-user account system.
- No complex personal data graph.

## 9. Phase 6: Streaming and Web UI

### User Result

The user can see model responses stream token by token in the terminal, and can also use Vole through a browser-based interface with chat, trace inspection, and permission approval controls.

### Architecture Added

- Streaming `ModelProvider` variant (token delta events)
- CLI rendering upgrade to **Ink** (React-based terminal UI): live streaming output, tool progress indicators, richer permission prompts
- Web app
- API layer over Agent Core
- Trace visualization
- Permission approval UI

### Learning Documents

- `docs/architecture/ui-adapters.md`
- `docs/architecture/trace-visualization.md`
- `docs/plans/phase-6-streaming-and-web-ui.md`

### CLI Rendering Note

Phase 6 is when the CLI rendering architecture needs to evolve. The current plain stdout output works for non-streaming turns but cannot support live streaming or in-place UI updates. The planned upgrade is to adopt **Ink** as the CLI rendering framework. Ink is a React-based terminal UI library — the same one OpenClaw uses — that lets components re-render in-place. The upgrade stays entirely within the CLI adapter layer; Agent Core and all other packages are unaffected. See [CLI Adapter](../architecture/cli-adapter.md) Section 15 for the full rationale and adoption criteria.

### Acceptance Criteria

- Model responses stream token by token in the CLI.
- The CLI uses Ink components for streaming output, progress, and approval prompts.
- Web UI can use the same Agent Core as CLI.
- Tool calls and permission prompts are visible in the UI.
- CLI and Web UI share session and trace concepts.

### Non-Goals

- No desktop app yet.
- No mobile app.
- No public hosted service.

## 10. Phase 7: Multi-Entry Adapters

### User Result

The user can interact with the same agent from multiple entry points while preserving the same core behavior.

### Architecture Added

- Entry adapter interface
- Shared session routing
- Adapter-specific capabilities
- Early gateway direction

### Learning Documents

- `docs/architecture/adapters.md`
- `docs/architecture/gateway.md`
- `docs/plans/phase-7-multi-entry-adapters.md`

Primary architecture note: [Adapters](../architecture/adapters.md)

Supporting architecture note: [Gateway](../architecture/gateway.md)

Implementation plan: [Phase 7 Multi-Entry Adapters](../plans/phase-7-multi-entry-adapters.md)

### Acceptance Criteria

- CLI and Web UI share Agent Core without duplicating orchestration logic.
- New adapters can be added with clear boundaries.
- Adapter capabilities can be represented explicitly.

### Non-Goals

- No full OpenClaw-style node network yet.
- No complex multi-device sync.

## 11. Phase 8: Background Automation

### User Result

The agent can run scheduled tasks or respond to configured events without a foreground chat session.

### Architecture Added

- Scheduler
- Daemon mode
- Task queue
- Event trigger interface
- Background trace persistence

### Learning Documents

- `docs/architecture/background-automation.md`
- `docs/architecture/task-queue.md`
- `docs/plans/phase-8-background-automation.md`

Primary architecture note: [Background Automation](../architecture/background-automation.md)

Supporting architecture note: [Task Queue](../architecture/task-queue.md)

Implementation plan: [Phase 8 Background Automation](../plans/phase-8-background-automation.md)

### Acceptance Criteria

- User can define a scheduled task.
- Background tasks produce traces.
- Dangerous actions still follow permission policy.
- Failed background tasks are visible to the user.

### Non-Goals

- No fully autonomous unrestricted execution.
- No enterprise workflow engine.

## 12. Phase 9: Plugin and Skill Ecosystem

### User Result

The user can install and manage skills or plugins with visible metadata, permissions, and trust boundaries.

### Architecture Added

- Plugin metadata format
- Skill/package installation path
- Enable/disable controls
- Permission declarations
- Version tracking
- Trust review flow

### Learning Documents

- `docs/architecture/plugin-system.md`
- `docs/architecture/skill-permissions.md`

Implementation plan: [Phase 9 Plugin and Skill Ecosystem](../plans/phase-9-plugin-skill-ecosystem.md)

### Acceptance Criteria

- Installed skills can be listed and disabled.
- Permission declarations are visible before use.
- Third-party skills cannot silently gain tool permissions.
- Version and source metadata are recorded.

### Non-Goals

- No public marketplace operation yet.
- No automatic trust of third-party code.

## 13. Phase 10: Full Personal Agent Platform

### User Result

Vole becomes a full personal agent platform: multi-entry, multi-model, multi-agent, extensible, observable, and safe enough for daily use.

### Architecture Added

- Gateway
- Multi-agent runtime
- Multi-node protocol
- Remote and local tool execution
- Stronger sandbox
- Provider ecosystem
- Mature product settings

### Learning Documents

- `docs/architecture/multi-agent-runtime.md`
- `docs/architecture/node-protocol.md`
- `docs/architecture/sandboxing.md`
- `docs/architecture/gateway.md`

Implementation plan: [Phase 10 Full Platform](../plans/phase-10-full-platform.md)

### Acceptance Criteria

- Multiple entry points can communicate with the same agent runtime.
- Multiple model providers can be configured.
- Agents can have separate workspaces and skills.
- Tool execution is observable and permissioned.
- The system remains usable as a real personal assistant.

### Non-Goals

- No guarantee of parity with OpenClaw.
- No enterprise SaaS assumptions unless explicitly chosen later.

## 14. OpenClaw Alignment Status

Phases 0–10 are complete. The OpenClaw alignment backlog originally tracked 18 capability gaps. All items have shipped.

Full design and iteration history: [OpenClaw Alignment Plan](../plans/openclaw-alignment.md)

| Capability | Status | Surface |
| --- | --- | --- |
| Context compaction | ✓ Shipped | `packages/context` `compactMessages`, `compaction_triggered` event, JSONL compact boundary |
| Skill body on-demand loading | ✓ Shipped | `load_skill` tool (`packages/tools`), `SkillManager` (`packages/skills`) |
| `memory_search` tool | ✓ Shipped | `packages/tools/memory_search`, indexes `MEMORY.md` + `memory/*.md` |
| `memory_get` tool | ✓ Shipped | `packages/tools/memory_get` |
| Prompt modes (full / minimal / none) | ✓ Shipped | `VOLE_PROMPT_MODE`, `PromptMode` in `packages/context` |
| Additional workspace files | ✓ Shipped | `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `USER.md`, `MEMORY.md` |
| Heartbeat mechanism | ✓ Shipped | `update_heartbeat` tool, daemon `writeHeartbeat` |
| Strict-agentic execution contract | ✓ Shipped | `VOLE_EXECUTION_CONTRACT`, contract enforcement in `AgentRuntime` |
| Per-session write locks | ✓ Shipped | Session mutex in `packages/sessions` |
| Hooks system | ✓ Shipped | `beforeTurn`, `beforeToolCall`, `onCompaction` |
| Tool profiles | ✓ Shipped | `filterToolsByProfile`, `VOLE_TOOL_PROFILE` |
| Sandbox enforcement | ✓ Shipped | `VOLE_SANDBOX=true` restricts shell to workspace root |
| Cron daemon | ✓ Shipped | `vole daemon`, `CronScheduler`, `BackgroundApprovalResolver` |
| TaskFlow | ✓ Shipped | `JsonlTaskFlowStore`, `vole taskflow list/show/cancel` |
| Async subagents | ✓ Shipped | `spawn_subagent_async`, `check_subagent` |
| WebSocket support | ✓ Shipped | `apps/web` `/ws/:id` bidirectional channel |
| Thinking budget configuration | ✓ Shipped | `VOLE_THINKING_BUDGET`, Anthropic provider |
| Memory dreaming / promotion | ✓ Shipped | `vole run --dream` consolidation flow |

### Known Partial Deliveries

Some Phase 0–10 designs landed in architecture documents but shipped narrower than the original design. New contributors should not assume these capabilities exist as documented:

| Capability | Design | Actual delivery | Closes in |
| --- | --- | --- | --- |
| Sub-agent `fork` context mode | Documented in `openclaw-alignment.md` Gap 15 | Only `isolated` mode implemented; `fork` parameter not exposed | Phase 12 |
| "Multi-agent" semantics | Phase 10 goal listed multi-agent | Only sub-agents shipped; independent agent identities not built | Phase 15 |
| Sandbox multi-backend | `sandboxing.md` implies multiple backends | Only `cwd` restriction and path traversal checks | Phase 16 |
| Channels (Telegram / Slack / Email) | `openclaw-architecture-map.md` §9–10 lists channels under Phase 7+ | No channel package or backend present | Phase 15 |
| Hybrid memory search | `memory-system.md` mentions hybrid retrieval | `memory_search` is keyword-only | Phase 13 |

## 15. Phase 11: Gateway and Lanes

Status: Complete. Plan document: [phase-11-gateway-and-lanes.md](../plans/phase-11-gateway-and-lanes.md).

Goal: establish the runtime infrastructure that every subsequent phase depends on — a real gateway layer, three-tier lane queues (global / subagent / session), normalized session key naming, and cross-process write locks.

Architecture added: expanded `GatewayCore` with `submit / cancel / status`; new `packages/lanes`; process-aware file lock around session JSONL via `acquireSessionFileLock`; `SessionMutex` removed in favour of lane composition; new `vole gateway status` command surfaces in-process lane occupancy and cross-process `.lock` sidecars.

Non-goals: no gateway HTTP / Unix socket transport; no multi-process daemon; no SQLite migration (Phase 14); no sub-agent behavior changes beyond key shape (Phase 12). The `subscribe` API and normalized `agent:<id>:<lane-type>:<uuid>` session key format are deferred to Phase 12 alongside the multi-agent runtime maturity work.

## 16. Phase 12: Multi-Agent Runtime Maturity

Status: Complete. Plan document: [phase-12-multi-agent-runtime-maturity.md](../plans/phase-12-multi-agent-runtime-maturity.md).

Goal: upgrade sub-agents from polling-based isolated spawn to OpenClaw-grade execution — push-based completion, `fork` context mode, depth and concurrency policy, and a `subagents` management surface.

Architecture added: `pendingAnnouncement` + `drainPendingForParent` on `@vole/taskflow`; AgentRuntime drains the mailbox at every turn start and injects each child's terminal summary as a `system` message; `SubagentFactoryOptions` with `contextMode`, `depth`, `parentSessionKey`, `parentMessages`; CLI factory strips spawn tools when `depth >= maxSpawnDepth` and threads parent transcript into `fork` mode; gateway-enforced `maxChildrenPerAgent` (default 5) and `runTimeoutSeconds`; new `subagents` model-callable tool plus `vole subagents list/kill` CLI surface; `NO_REPLY` suppression for fire-and-forget children.

Non-goals: no process or worker-thread isolation of children; no per-child identity (Phase 15); no streaming of child events into parent's user-facing stream; real-time cross-process cancellation deferred to daemon RPC (Phase 17+).

## 17. Phase 13: Memory and Prompt Enhancement

Status: Complete. Plan document: [phase-13-memory-and-prompt-enhancement.md](../plans/phase-13-memory-and-prompt-enhancement.md).

Goal: hybrid memory retrieval with embeddings, reviewable DREAMS.md promotion workflow, a complete 14-section system prompt aligned with OpenClaw, pre-compaction memory flush, and inline directive parsing (`/think`, `/stop`, `/compact`, `NO_REPLY`).

Architecture added (across Phase 13 + 13b): `packages/memory` with the three memory tools and a real `EmbeddingProvider` interface plus `FakeEmbeddingProvider`; hybrid `memory_search` that fuses vector top-K with keyword paragraph match via reciprocal rank fusion (default k=60); `DREAMS.md` parser / serializer + `vole memory review approve|reject` CLI for staged promotion to `MEMORY.md`; `memory_flush_triggered` runtime event + silent pre-compaction model call that runs memory-write tools without surfacing assistant text; six new optional sections on `ContextAssemblyInput` (`currentDateTime`, `executionBias`, `reasoningPolicy`, `replyTagsPolicy`, `documentationPolicy`, `selfUpdatePolicy`) emitted in the documented order; `parseInlineDirectives` in `@vole/context`; `vole compact` info command.

Non-goals: no Gemini / Mistral embeddings; no per-agent memory isolation (Phase 15); no memory-core plugin interface (Phase 16).

## 18. Phase 14: SQLite Storage Unification

Status: Complete. Plan document: [phase-14-sqlite-storage-unification.md](../plans/phase-14-sqlite-storage-unification.md).

Goal: migrate all persistent stores from JSONL to SQLite — sessions, TaskFlow records, and the memory index — with FTS5 keyword search, indexed queries, and atomic multi-record updates.

Architecture added (Phase 14 + 14b): `better-sqlite3` dependency; `SqliteSessionStore` and `SqliteTaskFlowStore` with WAL journal mode; `drainPendingForParent` as a single SQLite transaction; `SqliteMemoryIndex` (FTS5-backed paragraph index with content-hash idempotent reindex); `migrateJsonlSessionsToSqlite` / `migrateJsonlTaskFlowToSqlite` helpers; extracted `SQLITE_SESSIONS_SCHEMA_SQL` / `SQLITE_TASKFLOW_SCHEMA_SQL` / `SQLITE_MEMORY_INDEX_SCHEMA_SQL` DDL constants; `vole migrate jsonl-to-sqlite` CLI (dry-run + `--apply`); startup migration hint on interactive boot.

Non-goals: no PostgreSQL / remote database; no schema migration DSL; no removal of JSONL stores from the codebase.

## 19. Phase 15: Channels and Multi-Agent Identity

Status: Partial. Plan document: [phase-15-channels-and-multi-agent-identity.md](../plans/phase-15-channels-and-multi-agent-identity.md).

Goal: introduce independent multi-agent identity (`agents/<id>/` with own SOUL / AGENTS / MEMORY / credentials) and real channel integrations (Telegram and email) so Vole becomes a multi-surface personal agent platform.

Architecture added (Phase 15 + 15b): new `docs/architecture/channels.md`; bilingual Phase 15 callout on `multi-agent-runtime.md`; `@vole/channels` package with `Channel`, `ChannelRegistry`, `FakeChannel`, and `sessionKeyForInbound`; per-agent identity loader in `@vole/config` (`isValidAgentId`, `listAgentDirectories`, `resolveActiveAgentId`, `loadAgentIdentity`, `createAgentDirectory`, `setActiveAgentId`, `archiveAgentDirectory`) + `agents.default` + `VOLE_AGENT` env; `vole agents list / create / switch / remove --confirm` CLI; channel↔submitter bridge (`createGatewayInboundHandler`, `bridgeRegistryToSubmitter`) that pipes inbound channel messages through an adapter-supplied submitter so channels stay decoupled from the gateway.

Still deferred (external infrastructure): Telegram backend (`@vole/channels-telegram`) needs long-polling bot client + mock-server test harness; Email backend needs IMAP/SMTP clients + embedded mail test harness. Once they exist, the channel adapter registers them with `ChannelRegistry` and uses `bridgeRegistryToSubmitter` — no further architecture changes.

Non-goals: no Slack / Discord / WhatsApp / webhook channels (Phase 17+); no cross-agent direct invocation; no hosted multi-tenant deployment; no agent process isolation.

## 20. Phase 16: Sandbox and Plugin Runtime

Status: Complete. Plan document: [phase-16-sandbox-and-plugin-runtime.md](../plans/phase-16-sandbox-and-plugin-runtime.md).

Goal: real sandbox backends (workspace, Docker, worker thread) instead of a single boolean; worker-thread-isolated plugin runtime so untrusted skills cannot crash the main process; `vole doctor` self-maintenance.

Architecture added (Phase 16 + 16b): bilingual Phase 16 callouts on `sandboxing.md` and `plugin-system.md`; `SandboxBackend` interface in `@vole/permissions` with `SandboxCommand` / `SandboxOptions` / `SandboxResult` value types and three implementations — `WorkspaceSandbox` (workspace-escape rejection, cwd containment, timeout, non-zero exit propagation), `WorkerThreadSandbox` (node:worker_threads with timeout + memory cap), `DockerSandbox` (per-execution `docker run --rm` with workspace mounted read-only, network deny by default, daemon availability gated); `vole doctor` top-level CLI command with read-only checks AND `--fix` flag for idempotent remediations (delete stale `.lock` files, cancel stuck subagents, cancel orphan TaskFlow children).

Non-goals: no firejail / bubblewrap integration; no direct cgroup usage; no mandatory sandboxing of every tool; no remote sandbox dispatch.

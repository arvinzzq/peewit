# ArvinClaw Roadmap

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [overview.zh-CN.md](./overview.zh-CN.md)

## 1. Roadmap Principle

ArvinClaw should evolve through usable product milestones, not isolated technical experiments.

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

- Product track: every phase should make ArvinClaw more useful.
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

Some later-phase learning documents are listed as planned filenames before they exist. They should be created when that phase is being actively designed, not all at once during MVP setup.

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
- Project has a root README that explains what ArvinClaw is.
- Main design document links to the roadmap.
- Architecture documentation explains why Agent Core is separate from CLI.

### Non-Goals

- No complete agent loop yet.
- No Web UI.
- No plugin marketplace.
- No background automation.

## 4. Phase 1: MVP Agent Loop

### User Result

The user can start `arvinclaw chat`, send a message, receive a model response, and see an explainable trace of the interaction.

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

- `arvinclaw chat` starts an interactive session.
- The CLI can call an OpenAI-compatible model provider.
- The Agent Core does not import CLI-specific code.
- Each response produces a trace entry.
- Model configuration can be loaded from config files and environment variables.
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

ArvinClaw's `update_todos` follows the same model-called, no-infra-orchestration pattern.

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

### Non-Goals

- No cloud sync.
- No multi-user account system.
- No complex personal data graph.

## 9. Phase 6: Streaming and Web UI

### User Result

The user can see model responses stream token by token in the terminal, and can also use ArvinClaw through a browser-based interface with chat, trace inspection, and permission approval controls.

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

ArvinClaw becomes a full personal agent platform: multi-entry, multi-model, multi-agent, extensible, observable, and safe enough for daily use.

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

## 14. Immediate Next Step

After this roadmap is reviewed, the next design work should create the first architecture documents for:

- Project structure
- Agent loop
- Model provider
- Tool system
- Permission system
- Skill system
- Execution trace

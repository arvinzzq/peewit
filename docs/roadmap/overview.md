# ArvinClaw Roadmap

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [overview.zh-CN.md](./overview.zh-CN.md)

## 1. Roadmap Principle

ArvinClaw should evolve through usable product milestones, not isolated technical experiments.

Reference systems: [Reference Systems](../architecture/reference-systems.md)

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

| Phase | Goal | Product Result | Architecture Focus |
| --- | --- | --- | --- |
| Phase 0 | Project foundation | A documented TypeScript workspace with CLI shell | Monorepo, config, documentation layout |
| Phase 1 | MVP agent loop | CLI chat can call a model and produce traceable responses | Agent Core, ModelProvider, basic loop |
| Phase 2 | Tools and permissions | Agent can inspect files, run approved commands, and read web content | Tool Registry, PermissionPolicy |
| Phase 3 | Lightweight skills | Agent can load local `SKILL.md` instructions | Skill loader, skill precedence, prompt assembly |
| Phase 4 | Planning and autonomy | Agent can plan tasks and run in `observe`, `confirm`, or `auto` mode | Planner, task state, execution modes |
| Phase 5 | Sessions and memory | Agent remembers sessions and can use local knowledge | Session store, trace store, memory interfaces |
| Phase 6 | Web UI | User can chat, inspect traces, and approve actions in a browser | UI adapter, API boundary, trace visualization |
| Phase 7 | Multi-entry adapters | CLI, Web, desktop, and message entries share one Agent Core | Adapter interface, gateway direction |
| Phase 8 | Background automation | Agent can run scheduled and event-triggered tasks | Scheduler, daemon, task queue |
| Phase 9 | Plugin and skill ecosystem | User can install, enable, disable, and review capabilities | Plugin metadata, permission declarations, versioning |
| Phase 10 | Full personal agent platform | OpenClaw-like personal agent with multiple models, agents, nodes, and sandboxed tools | Gateway, multi-agent runtime, node protocol, sandboxing |

## 3. Phase 0: Project Foundation

### User Result

The user can inspect a clean project structure and understand the intended architecture before implementation begins.

### Architecture Added

- Lightweight monorepo structure
- CLI app boundary
- Package boundaries for core, models, tools, skills, permissions, and sessions
- Configuration file conventions
- Documentation structure

### Learning Documents

- `docs/roadmap/overview.md`
- `docs/architecture/project-structure.md`
- Main design document under `docs/superpowers/specs/`

Primary architecture note: [Project Structure](../architecture/project-structure.md)

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
- `ModelProvider` interface
- OpenAI-compatible model provider
- Basic agent loop
- Execution trace model
- CLI chat adapter

### Learning Documents

- `docs/architecture/agent-loop.md`
- `docs/architecture/model-provider.md`
- `docs/architecture/execution-trace.md`

Primary architecture note: [Agent Loop](../architecture/agent-loop.md)

Supporting architecture note: [Model Provider](../architecture/model-provider.md)

Supporting architecture note: [Execution Trace](../architecture/execution-trace.md)

### Acceptance Criteria

- `arvinclaw chat` starts an interactive session.
- The CLI can call an OpenAI-compatible model provider.
- The Agent Core does not import CLI-specific code.
- Each response produces a trace entry.
- Model configuration can be loaded from config files and environment variables.

### Non-Goals

- No complex planning.
- No long-term memory.
- No Web UI.
- No multi-agent runtime.

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

## 6. Phase 3: Lightweight Skills

### User Result

The agent can load local skills and use them to guide behavior for common workflows such as research, project inspection, task planning, documentation writing, and safe shell usage.

### Architecture Added

- Skill directory scanner
- `SKILL.md` parser
- Skill precedence rules
- Built-in skill loading
- Skill-aware prompt assembly

### Learning Documents

- `docs/architecture/skill-system.md`

Primary architecture note: [Skill System](../architecture/skill-system.md)

### Acceptance Criteria

- Skills can load from project, user, and built-in locations.
- Project skills override user and built-in skills with the same name.
- The CLI can list loaded skills.
- Skills influence agent behavior without bypassing Tool and Permission systems.

### Non-Goals

- No remote skill installation.
- No public marketplace.
- No skill version manager.
- No arbitrary permission grant from skill files.

## 7. Phase 4: Planning and Autonomy

### User Result

The agent can decompose a goal into steps, execute the steps with visible progress, and operate in `observe`, `confirm`, or `auto` mode.

### Architecture Added

- Planner
- Task state model
- Plan update loop
- Autonomy mode policy
- Failure recovery path

### Learning Documents

- `docs/architecture/planner.md`
- `docs/architecture/autonomy-modes.md`

### Acceptance Criteria

- Complex tasks can produce a plan before execution.
- Plan steps can be marked pending, running, complete, failed, or skipped.
- `observe` mode pauses at each step.
- `confirm` mode follows the permission policy.
- `auto` mode continues within allowed policy boundaries.
- Failures are summarized and can update the plan.

### Non-Goals

- No autonomous background daemon yet.
- No multi-agent task delegation.
- No advanced workflow language.

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
- `docs/architecture/memory.md`
- `docs/architecture/local-knowledge.md`

Primary architecture note: [Session Storage](../architecture/session-storage.md)

Supporting architecture note: [Memory System](../architecture/memory-system.md)

### Acceptance Criteria

- Sessions can be saved and resumed.
- Traces can be inspected after a session ends.
- Memory is separated from raw chat history.
- The first memory implementation can be replaced later.

### Non-Goals

- No cloud sync.
- No multi-user account system.
- No complex personal data graph.

## 9. Phase 6: Web UI

### User Result

The user can use ArvinClaw through a browser-based interface with chat, trace inspection, and permission approval controls.

### Architecture Added

- Web app
- API layer over Agent Core
- Streaming response channel
- Trace visualization
- Permission approval UI

### Learning Documents

- `docs/architecture/ui-adapters.md`
- `docs/architecture/trace-visualization.md`

### Acceptance Criteria

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

# OpenClaw Architecture Map

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [openclaw-architecture-map.zh-CN.md](./openclaw-architecture-map.zh-CN.md)

## 1. Purpose

Peewit's target is to implement an OpenClaw-like personal general-purpose agent system from zero to one.

This document maps OpenClaw concepts to Peewit phases so the project can intentionally grow toward that target without overloading the MVP.

The core rule:

OpenClaw is the primary architecture reference. Peewit implements its core ideas in staged, testable increments.

Implementation research notes: [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)

Compatibility decision: [0002: OpenClaw-Aligned, Not Identical](../decisions/0002-openclaw-aligned-not-identical.md)

## 2. Mapping Summary

| OpenClaw Concept | Peewit Plan | Phase |
| --- | --- | --- |
| Agent workspace | Local Peewit workspace with prompt, memory, skill, and config files | Phase 0-1 |
| `AGENTS.md` | Project and agent operating rules | Phase 0-1 |
| `SOUL.md` | Agent identity, values, tone, and boundaries | Phase 1-2 |
| `USER.md` | User preferences and durable user context | Phase 5 |
| `MEMORY.md` | Curated long-term memory | Phase 5 |
| `memory/YYYY-MM-DD.md` | Daily notes and recent observations | Phase 5 |
| `TOOLS.md` | Environment and tool notes | Phase 5-6 |
| Skills | Local `SKILL.md` system first, plugin ecosystem later | Phase 3, Phase 9 |
| Tools | File, shell, web tools first; more tools later | Phase 2+ |
| Permissions | Risk-based allow/ask/deny/block policy | Phase 2 |
| Session startup loading | Controlled prompt and memory loading order | Phase 1-5 |
| Gateway / multi-entry | Shared Agent Core with adapters | Phase 6-7 |
| Channels | Messaging and external entry adapters | Phase 7+ |
| Heartbeat / background automation | Scheduler, daemon, event triggers | Phase 8 |
| Memory search | Search over durable memory and local knowledge | Phase 5+ |
| Dreaming / memory promotion | Reviewable promotion from short-term signals to durable memory | Phase 8+ |
| Multi-agent | Multiple agents with separate workspaces and permissions | Phase 10 |
| Remote/local nodes | Multi-node tool execution | Phase 10 |
| Security around workspace files | Permission checks, redaction, drift detection later | Phase 2+ |

## 3. Agent Workspace

OpenClaw uses an agent workspace as the visible home of identity, memory, and operational context.

Peewit should implement a workspace model with:

- Prompt files
- Memory files
- Project-local skills
- Configuration
- Session and trace references
- Future plugin metadata

MVP should start small:

```text
peewit.config.json
AGENTS.md
skills/
docs/
```

Future workspace shape:

```text
AGENTS.md
SOUL.md
USER.md
MEMORY.md
TOOLS.md
memory/
  YYYY-MM-DD.md
skills/
peewit.config.json
```

## 4. Workspace Prompt Files

Peewit should support OpenClaw-like prompt files with explicit scope and safety.

| File | Responsibility | Write Policy |
| --- | --- | --- |
| `AGENTS.md` | Operating rules and project instructions | User/project edited |
| `SOUL.md` | Agent identity, values, tone, boundaries | Read-only by default |
| `USER.md` | User preferences and personal context | User-approved writes only |
| `MEMORY.md` | Curated durable memory | User-approved writes only |
| `TOOLS.md` | Environment and tool notes | User/project edited |

Prompt files should be loaded through the context assembly pipeline, not by ad hoc file reads.

## 5. Memory Layers

Peewit should mirror OpenClaw's plain-file memory direction, but phase it carefully.

MVP:

- Active context
- Session memory through session storage
- Trace history

Later:

- Daily notes
- `MEMORY.md`
- Memory search
- Memory promotion
- Reviewable memory updates

No long-term memory file should be silently updated by the agent.

## 6. Skills and Plugins

OpenClaw's skill/plugin direction is central to extensibility.

Peewit should implement:

- Phase 3: local `SKILL.md` skill loading
- Phase 3: built-in skills such as `research`, `project-inspector`, `task-planner`, `docs-writer`, and `safe-shell`
- Phase 9: installable plugins and skill ecosystem
- Phase 9: permission declarations for plugin capabilities

Skills should guide behavior. Plugins may later contribute tools, prompts, or adapters, but only through permissioned interfaces.

## 7. Tools and Permissions

OpenClaw-like agents are powerful because they can act. Peewit should make action safe from the beginning.

MVP tools:

- File read/list/write
- Shell
- Web search
- Web page reading

MVP permission model:

- Low
- Medium
- High
- Blocked

Every tool call should produce trace and pass through permission policy.

## 8. Session Startup Loading

OpenClaw-style systems rely on reading workspace context at session start.

Peewit should implement startup loading in stages.

MVP startup:

```text
Base system instructions
  -> Configuration
  -> Session resume context
  -> Selected skills
```

OpenClaw-like target startup:

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
```

Each added source should be tested and visible in trace.

## 9. Gateway and Multi-Entry

OpenClaw's broader shape includes gateways and multiple user surfaces.

Peewit should reach this through adapters:

- CLI first
- Web UI
- Desktop app
- Messaging platforms
- Background automation

Agent Core should stay shared. Entry adapters should not reimplement core behavior.

## 10. Channels

Channels are deferred until after Web UI and adapter boundaries are stable.

Future channels may include:

- Telegram
- Slack
- Discord
- Email
- Local desktop notifications

Channels need stricter privacy and permission rules because the agent may speak in public or semi-public spaces.

## 11. Heartbeat and Background Automation

OpenClaw-style long-running agents need background behavior.

Peewit should implement this later through:

- Scheduler
- Daemon mode
- Task queue
- Event triggers
- Background traces
- Approval handling for pending risky actions

MVP should not include autonomous background work.

## 12. Multi-Agent and Nodes

Multi-agent and multi-node architecture should be late-stage.

Future target:

- Multiple agents
- Separate workspaces
- Separate `SOUL.md` and memory files
- Agent-specific tools and permissions
- Local and remote tool nodes
- Parent/child trace linkage

This should not be implemented before core loop, permissions, sessions, memory, and adapters are stable.

## 13. Security Risks to Track

OpenClaw-like architecture introduces specific risks:

- Prompt injection into workspace files
- Malicious edits to `SOUL.md`
- Memory poisoning
- Secret leakage through memory or trace
- Dangerous tool invocation
- Plugin supply-chain risk
- Channel privacy mistakes
- Background automation running at the wrong time

Peewit should treat these as design requirements, not afterthoughts.

## 14. Testing Requirements

OpenClaw-like features require safety-focused tests.

Required test areas:

- Workspace file loading order
- Missing or malformed workspace files
- Read-only identity files
- Memory write approval
- Tool permission enforcement
- Trace visibility for workspace file reads
- Secret redaction
- Prompt injection regression tests
- Adapter-specific privacy behavior
- Background task permission handling

Each OpenClaw concept added to Peewit should arrive with tests.

## 15. Acceptance Criteria

This map is successful when:

- OpenClaw is clearly documented as the primary reference.
- Each major OpenClaw concept has an Peewit phase.
- MVP scope remains small but points toward the full OpenClaw-like target.
- Memory, identity, tools, permissions, gateway, channels, and background automation are staged.
- Safety and testing requirements are documented before implementation.

## 16. Sources

- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Default AGENTS.md](https://docs.openclaw.ai/reference/AGENTS.default)
- [OpenClaw SOUL.md Template](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)

## 17. Related Documents

- [Reference systems](./reference-systems.md)
- [Memory system](./memory-system.md)
- [Workspace files](./workspace-files.md)
- [Session storage](./session-storage.md)
- [Permission system](./permission-system.md)
- [Skill system](./skill-system.md)
- [Roadmap](../roadmap/overview.md)

# Reference Systems

Status: Active
Date: 2026-05-11

Simplified Chinese version: [reference-systems.zh-CN.md](./reference-systems.zh-CN.md)

## 1. Purpose

Vole should learn from existing agent systems without copying them blindly.

OpenClaw is the primary reference system because Vole's target is to implement an OpenClaw-like personal general-purpose agent from zero to one.

Claude Code is a secondary reference system. It is useful for engineering practices around CLI workflows, project memory, permissions, hooks, subagents, and developer-agent ergonomics.

Reference priority:

- Primary: OpenClaw
- Secondary: Claude Code

The core rule:

Implement OpenClaw-like architecture deliberately, while using Claude Code to strengthen developer workflow and engineering discipline.

## 2. What to Learn from OpenClaw

OpenClaw is useful because it shows how a personal agent can maintain identity, memory, tools, and long-running behavior through an agent workspace.

Vole should study these OpenClaw ideas:

- Workspace files such as `SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, and `TOOLS.md`
- Daily memory files such as `memory/YYYY-MM-DD.md`
- File-based memory as visible source of truth
- Session startup context loading
- Personal identity and tone through `SOUL.md`
- User context through `USER.md`
- Long-term memory through `MEMORY.md`
- Channels and multi-entry interaction
- Gateway direction for multiple surfaces and agents
- Background tasks and heartbeat-style automation
- Multi-agent and multi-workspace direction

These ideas define the long-term shape of Vole.

Detailed OpenClaw mapping: [OpenClaw Architecture Map](./openclaw-architecture-map.md)

Implementation research notes: [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)

## 3. What to Learn from Claude Code

Claude Code is useful because it shows how an agent can work deeply inside a codebase while keeping user control and project conventions visible.

Vole should study these Claude Code ideas:

- CLI-first developer workflow
- Project memory through `CLAUDE.md`
- User and project settings hierarchy
- Permission allow/deny configuration
- Hooks around tool use and lifecycle events
- Subagents with separate context windows and tool permissions
- Custom slash commands
- Multi-surface usage over time: terminal, IDE, desktop, and web

These ideas are especially relevant to Vole's early CLI, developer-agent, and engineering-quality phases.

## 4. Comparison

| Area | Claude Code Reference | OpenClaw Reference | Vole Direction |
| --- | --- | --- | --- |
| First interface | CLI developer workflow | Messaging and personal assistant surfaces | CLI first, Web UI later, more adapters over time |
| Project instructions | `CLAUDE.md` | `AGENTS.md` and workspace files | Start with `AGENTS.md`-style instructions, later support more workspace files |
| Identity | Less central, task-oriented | `SOUL.md` and `IDENTITY.md` are central | Support `SOUL.md` as read-only prompt identity after prompt safety is clear |
| User context | Memory files and settings | `USER.md` | Design `USER.md`, defer writes until privacy policy is clear |
| Memory | Hierarchical memory and auto memory concepts | `MEMORY.md`, daily notes, memory tools | MVP session memory; long-term memory deferred with explicit policy |
| Tools | Codebase tools, shell, file edits, MCP | Skills, local tools, channels, plugins | File/shell/web tools first; plugin ecosystem later |
| Hooks | Tool and lifecycle hooks | Hooks and workspace behavior | Defer hooks until tool and permission systems are stable |
| Subagents | First-class subagents with separate context and tool access | Multi-agent workspaces | Defer multi-agent until core loop and adapter boundary are stable |
| Permissions | Settings-based allow/deny and tool permissions | Workspace and tool safety model | Risk-based permission system from MVP |

## 5. Prompt and Workspace File Plan

Vole should start from OpenClaw's workspace model and supplement it with Claude Code's engineering practices.

Proposed prompt files:

- `AGENTS.md`: operating rules, project instructions, and development conventions.
- `SOUL.md`: agent identity, values, tone, and boundaries.
- `USER.md`: user context, preferences, and privacy boundaries.
- `MEMORY.md`: curated long-term memory.
- `memory/YYYY-MM-DD.md`: daily notes and recent observations.
- `TOOLS.md`: environment and tool notes.

MVP should not load all of these automatically. Instead:

- Start with base system instructions, configuration, session storage, and skills.
- Add `AGENTS.md` or project instruction loading early.
- Add `SOUL.md` as read-only prompt identity after redaction and trace rules exist.
- Defer `USER.md`, `MEMORY.md`, and daily memory writes until user approval and permission policies are designed.

## 6. Configuration Plan

Claude Code's settings hierarchy is a useful reference.

Vole should support:

- User config: `~/.vole/config.json`
- Project config: `vole.config.json`
- Future local-only project config for uncommitted preferences
- Environment variables for secrets

Configuration should not become memory. It describes runtime behavior; memory describes learned or durable context.

## 7. Hook Plan

Claude Code hooks are useful, but Vole should not implement hooks too early.

Future hook events may include:

- Before tool use
- After tool use
- Before model call
- After model response
- Session start
- Before compaction
- Task stop
- Subagent stop

Hooks should be deferred until:

- Tool System is stable
- Permission System is stable
- Trace System is stable
- Configuration has allow/deny controls

Hooks can be powerful, so they should have tests and permission boundaries from the start.

## 8. Subagent Plan

Claude Code's subagents are a strong reference for task-specific workers with separate context and tool permissions.

Vole should defer subagents until after:

- Agent Loop
- Tool System
- Permission System
- Session Storage
- Execution Trace
- Planner

Future subagents should have:

- Name
- Description
- Purpose
- Allowed tools
- Model selection
- Separate context
- Trace linkage to parent task
- Permission boundaries

## 9. What Not to Copy

Vole should not copy everything from either system.

Do not copy too early:

- Full plugin marketplace
- Complex hook runtime
- Multi-agent delegation
- Automatic long-term memory writes
- Rich gateway architecture
- Messaging channel integrations
- Cloud or enterprise assumptions

The MVP should stay small enough to understand and test.

## 10. Testing Requirements

Reference-inspired features need tests when implemented.

Required future test areas:

- Prompt file loading order
- Settings precedence
- Secret file denial
- Hook permission boundaries
- Subagent tool restrictions
- Memory write approval
- Workspace file redaction
- Regression tests for prompt injection through identity or memory files

Reference systems should influence test design as much as feature design.

## 11. Acceptance Criteria

This reference plan is successful when:

- Vole documents OpenClaw as the primary reference and Claude Code as a secondary engineering reference.
- Borrowed ideas are mapped to Vole phases.
- MVP scope remains smaller than either full reference system.
- Prompt files, memory, hooks, and subagents have staged plans.
- Safety and testing requirements are documented before implementation.

## 12. Sources

- [Claude Code overview](https://code.claude.com/docs/en/overview)
- [Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings)
- [Claude Code memory](https://docs.claude.com/en/docs/claude-code/memory)
- [Claude Code subagents](https://docs.claude.com/en/docs/claude-code/subagents)
- [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Default AGENTS.md](https://docs.openclaw.ai/reference/AGENTS.default)
- [OpenClaw SOUL.md Template](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)

## 13. Related Documents

- [Main design](../product/vole-design.md)
- [Roadmap](../roadmap/overview.md)
- [OpenClaw architecture map](./openclaw-architecture-map.md)
- [Memory system](./memory-system.md)
- [Session storage](./session-storage.md)
- [Permission system](./permission-system.md)
- [Skill system](./skill-system.md)

# Vole Documentation

Status: Active
Date: 2026-05-11

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## 1. Purpose

This directory is the product and learning documentation home for Vole.

Vole is intended to become a real personal general-purpose agent product and a learning project for understanding OpenClaw-like agent architecture. The documentation should explain both what we are building and why each module exists.

## 2. Reading Order

Recommended first reading path:

1. [Main Design](./product/vole-design.md)
2. [Roadmap](./roadmap/overview.md)
3. [Reference Systems](./architecture/reference-systems.md)
4. [OpenClaw Architecture Map](./architecture/openclaw-architecture-map.md)
5. [Project Structure](./architecture/project-structure.md)
6. [CLI Adapter](./architecture/cli-adapter.md)
7. [Agent Loop](./architecture/agent-loop.md)

This order starts with product intent, then moves into architecture boundaries.

## 3. Documentation Areas

| Area | Purpose |
| --- | --- |
| `product/` | Accepted product and design drafts |
| `roadmap/` | Product phases, phase goals, acceptance criteria, and non-goals |
| `architecture/` | Module-level architecture explanations |
| `research/` | External system research and source notes |
| `decisions/` | Architecture decisions and trade-offs |
| `plans/` | Phase implementation plans before code work begins |

## 4. Current Core Architecture Documents

Foundation:

- [Project Structure](./architecture/project-structure.md)
- [Configuration System](./architecture/configuration-system.md)
- [Runtime Composition](./architecture/runtime-composition.md)
- [Architecture Contracts](./architecture/contracts.md)
- [Progressive Composition](./architecture/progressive-composition.md)
- [Testing Strategy](./architecture/testing-strategy.md)
- [Development Workflow](./architecture/dev-workflow.md)
- [Documentation System](./architecture/documentation-system.md)

Core runtime:

- [CLI Adapter](./architecture/cli-adapter.md)
- [Agent Loop](./architecture/agent-loop.md)
- [Model Provider](./architecture/model-provider.md)
- [Prompt Assembly](./architecture/prompt-assembly.md)
- [Context Engine](./architecture/context-engine.md)
- [Context Compaction](./architecture/context-compaction.md)
- [Execution Trace](./architecture/execution-trace.md)
- [Execution Contract](./architecture/execution-contract.md)
- [Hooks](./architecture/hooks.md)
- [Run Queue](./architecture/run-queue.md)

Capabilities:

- [Tool System](./architecture/tool-system.md)
- [Tool Profiles](./architecture/tool-profiles.md)
- [Permission System](./architecture/permission-system.md)
- [Sandboxing](./architecture/sandboxing.md)
- [Skill System](./architecture/skill-system.md)
- [Skill Permissions](./architecture/skill-permissions.md)
- [Plugin System](./architecture/plugin-system.md)
- [Session Storage](./architecture/session-storage.md)
- [Memory System](./architecture/memory-system.md)
- [Workspace Files](./architecture/workspace-files.md)
- [Task Flow](./architecture/task-flow.md)
- [Task Queue](./architecture/task-queue.md)
- [Background Automation](./architecture/background-automation.md)

Adapters & multi-entry:

- [Adapters](./architecture/adapters.md)
- [UI Adapters](./architecture/ui-adapters.md)
- [Trace Visualization](./architecture/trace-visualization.md)
- [Gateway](./architecture/gateway.md)
- [Multi-Agent Runtime](./architecture/multi-agent-runtime.md)
- [Node Protocol](./architecture/node-protocol.md)

Reference and alignment:

- [Reference Systems](./architecture/reference-systems.md)
- [OpenClaw Architecture Map](./architecture/openclaw-architecture-map.md)
- [OpenClaw Implementation Notes](./research/openclaw-implementation-notes.md)

## 5. Plans

Implementation should not begin until the relevant phase plan is written and reviewed.

Phase plans (all 10 phases complete):

- [Phase 0 Foundation](./plans/phase-0-foundation.md)
- [Phase 1 MVP Agent Loop](./plans/phase-1-mvp-agent-loop.md) · [Phase 1 Test Guide](./plans/phase-1-mvp-test-guide.md)
- [Phase 2 Tools and Permissions](./plans/phase-2-tools-and-permissions.md)
- [Phase 3 Context Assembly and Skills](./plans/phase-3-context-assembly-and-skills.md) · [Phase 3 Refinements](./plans/phase-3-refinements.md)
- [Phase 4 In-Turn Task Tracking](./plans/phase-4-in-turn-task-tracking.md) · [Phase 4 Planning and Autonomy](./plans/phase-4-planning-and-autonomy.md)
- [Phase 5 Sessions and Memory](./plans/phase-5-sessions-and-memory.md)
- [Phase 6 Streaming and Web UI](./plans/phase-6-streaming-and-web-ui.md)
- [Phase 7 Multi-Entry Adapters](./plans/phase-7-multi-entry-adapters.md)
- [Phase 8 Background Automation](./plans/phase-8-background-automation.md)
- [Phase 9 Plugin and Skill Ecosystem](./plans/phase-9-plugin-skill-ecosystem.md)
- [Phase 10 Full Platform](./plans/phase-10-full-platform.md)
- [OpenClaw Alignment Plan](./plans/openclaw-alignment.md)

## 6. Decisions

Current decision records:

- [0001: OpenClaw-Aligned Core Architecture](./decisions/0001-openclaw-aligned-core-architecture.md)
- [0002: OpenClaw-Aligned, Not Identical](./decisions/0002-openclaw-aligned-not-identical.md)
- [0003: Technology Stack Selection](./decisions/0003-technology-stack-selection.md)
- [0004: Documentation Maintenance Policy](./decisions/0004-documentation-maintenance-policy.md)
- [0005: Anthropic Provider](./decisions/0005-anthropic-provider.md)
- [0006: XML Prompt Format and Caching](./decisions/0006-xml-prompt-format-and-caching.md)

## 7. Language Policy

Every important project document should have both English and Simplified Chinese versions.

Rules:

- English files use `.md`.
- Simplified Chinese files use `.zh-CN.md`.
- The two versions must be complete translations of the same content.
- Headings, tables, examples, diagrams, testing requirements, and acceptance criteria must stay structurally aligned.
- Updates should change both language versions in the same pass.

## 8. Documentation Quality Bar

Each architecture document should explain:

- Why the module exists
- What responsibility it owns
- What inputs and outputs it has
- What it must not own
- How it collaborates with other modules
- What tests protect it
- What is deferred

Docs should be specific enough to guide implementation, but not pretend to be final code contracts until implementation validates them.

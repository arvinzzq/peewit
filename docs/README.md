# Vole Documentation

Status: Draft
Date: 2026-05-02

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
- [Testing Strategy](./architecture/testing-strategy.md)
- [Development Workflow](./architecture/dev-workflow.md)
- [Documentation System](./architecture/documentation-system.md)

MVP runtime:

- [CLI Adapter](./architecture/cli-adapter.md)
- [Agent Loop](./architecture/agent-loop.md)
- [Model Provider](./architecture/model-provider.md)
- [Prompt Assembly](./architecture/prompt-assembly.md)
- [Context Engine](./architecture/context-engine.md)
- [Execution Trace](./architecture/execution-trace.md)
- [Run Queue](./architecture/run-queue.md)

Capabilities:

- [Tool System](./architecture/tool-system.md)
- [Permission System](./architecture/permission-system.md)
- [Skill System](./architecture/skill-system.md)
- [Session Storage](./architecture/session-storage.md)
- [Memory System](./architecture/memory-system.md)
- [Workspace Files](./architecture/workspace-files.md)

Reference and alignment:

- [Reference Systems](./architecture/reference-systems.md)
- [OpenClaw Architecture Map](./architecture/openclaw-architecture-map.md)
- [OpenClaw Implementation Notes](./research/openclaw-implementation-notes.md)

## 5. Plans

Implementation should not begin until the relevant phase plan is written and reviewed.

Planned phase documents:

- [Phase 0 Foundation](./plans/phase-0-foundation.md)
- [Phase 1 MVP Agent Loop](./plans/phase-1-mvp-agent-loop.md)
- [Phase 2 Tools and Permissions](./plans/phase-2-tools-and-permissions.md)

## 6. Decisions

Current decision records:

- [0001: OpenClaw-Aligned Core Architecture](./decisions/0001-openclaw-aligned-core-architecture.md)
- [0002: OpenClaw-Aligned, Not Identical](./decisions/0002-openclaw-aligned-not-identical.md)
- [0003: Technology Stack Selection](./decisions/0003-technology-stack-selection.md)
- [0004: Documentation Maintenance Policy](./decisions/0004-documentation-maintenance-policy.md)

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

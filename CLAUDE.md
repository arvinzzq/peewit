# ArvinClaw — Claude Code Instructions

## Project Context

ArvinClaw is an OpenClaw-inspired personal general-purpose agent in TypeScript (pnpm monorepo). It is both a real usable product and an architecture learning project. CLI is the first adapter, not the agent's identity.

Key docs:
- Architecture: `docs/architecture/`
- Roadmap: `docs/roadmap/overview.md`
- OpenClaw research: `docs/research/openclaw-implementation-notes.md`
- Phase plans: `docs/plans/`

## Before Every Commit

Run `pnpm run check` (typecheck + tests + docs:check). Do not commit if it fails.

## Commit Rules

**Code and docs move together in the same commit.** A feature or refactor commit must include:
- Updated `packages/*/README.md` + `README.zh-CN.md` (file inventory rows)
- Updated `packages/*/AGENTS.md` + `AGENTS.zh-CN.md` (if responsibilities changed)
- Updated source file header (`/* INPUT / OUTPUT / POS */`) when inputs, outputs, or system position changed
- Updated global docs (`docs/roadmap/overview.md`, root `README.md`) when phase status changes

A standalone `docs:` commit is only for pure documentation (research notes, architecture docs, plans) that precedes implementation.

Granularity: one logical change per commit. Never batch unrelated changes.

## Documentation Rules

- Every important doc must exist in English `.md` AND Simplified Chinese `.zh-CN.md`.
- Update bilingual docs together — never let one language drift behind.
- The docs:check script enforces heading count parity between EN and zh-CN pairs.
- Docs-first: for significant architecture decisions, update docs before writing code.

## Testing Rules

- No real API keys in tests — use `FakeModelProvider`, `MessageMappedFakeModelProvider`, or injected fakes.
- Add or update tests when behavior changes.
- `pnpm run check` must pass before any commit.

## Architecture Boundaries

- `apps/cli`: terminal adapter only — no agent logic, no prompt assembly
- `packages/core`: runtime orchestration, no vendor APIs, no CLI rendering
- `packages/context`: prompt/context assembly, provider-neutral output
- `packages/models`: provider-specific API translation only
- `packages/tools`: capabilities only, no permission decisions
- `packages/permissions`: allow/ask/deny/block decisions only
- `packages/sessions`: persistence only

## OpenClaw Alignment

Research notes are the source of truth for OpenClaw architecture decisions: `docs/research/openclaw-implementation-notes.md`. Before making architectural decisions, check whether OpenClaw has a confirmed pattern. If uncertain, do a research pass first.

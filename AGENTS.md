# Vole — Workspace Context

This is the Vole monorepo: a TypeScript pnpm workspace implementing an OpenClaw-inspired personal agent. 12 packages + 2 adapter apps.

## Essential Commands

```bash
pnpm run check          # typecheck + tests + docs parity — must pass before every commit
pnpm cli chat           # interactive CLI (no build needed)
pnpm cli run "<goal>"   # one-shot background task
pnpm run test:watch     # tests in watch mode
```

## Package Map (quick orientation)

```
packages/core        — AgentRuntime, 17-event loop, planning stall detection
packages/context     — XML system prompt assembly, prompt caching
packages/models      — OpenAI-compatible + Anthropic providers
packages/tools       — read_file, write_file, search_files, run_shell, read_web_page, memory tools
packages/permissions — allow/ask/deny policy (observe/confirm/auto × low/medium/high/blocked)
packages/sessions    — JSONL session + trace storage
packages/skills      — SKILL.md loader, precedence, lifecycle
packages/adapters    — ToolProfile, AdapterCapabilities, filterToolsByProfile
packages/config      — EffectiveConfig, env overrides
packages/scheduler   — CronScheduler, BackgroundApprovalResolver
packages/taskflow    — Persistent task graph, 8 statuses
packages/gateway     — Cross-adapter session registry
apps/cli             — Ink terminal adapter
apps/web             — Hono API + React frontend
```

## Hard Boundaries (never cross)

- `core` never imports from apps or infrastructure (config, sessions, etc.)
- Infrastructure packages never import from `core`
- `models` has no knowledge of agent logic
- No circular dependencies

## Commit Rules

- Run `pnpm run check` first — do not commit if it fails
- Code + bilingual docs (README.md + README.zh-CN.md) move in the same commit
- Source file headers (INPUT/OUTPUT/POS) updated when responsibilities change
- One logical change per commit

## Finding Things

Use `search_files` to locate code before editing. Each package has a README — read it first.
Research notes on OpenClaw: `docs/research/openclaw-implementation-notes.md`.

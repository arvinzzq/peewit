# ArvinClaw

> A personal general-purpose agent — OpenClaw-inspired, TypeScript, real and usable.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Tests](https://img.shields.io/badge/tests-339%20passing-22c55e)](#development)

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

---

## What is ArvinClaw?

ArvinClaw is a personal general-purpose agent built from first principles in TypeScript.

It is both a **real, usable product** and an **architecture learning project**. Every module — agent loop, tool execution, permission policy, context assembly, session storage, streaming, and multi-agent coordination — is implemented deliberately, documented thoroughly, and tested.

The reference architecture is [OpenClaw](https://openclaw.ai). ArvinClaw implements its core ideas in a clean, staged, independently deployable TypeScript monorepo.

---

## Features

### Agent Core
- **Agent loop** — context assembly → model inference → tool execution → streaming replies → persistence
- **Streaming output** — token-by-token via SSE (Web) and Ink terminal rendering (CLI)
- **Planning stall detection** — detects plan-only turns and forces immediate action via retry injection
- **In-turn task tracking** — model-callable `update_todos` (equivalent to OpenClaw `update_plan`)
- **Sub-agent spawning** — `spawn_subagent` (blocking) and `spawn_subagent_async` (fire-and-forget) tools
- **Context compaction** — automatic conversation summarization before context overflow
- **Execution contracts** — `default` and `strict-agentic` modes for deeper planning discipline
- **Hooks** — `beforeTurn`, `afterTurn`, `beforeToolCall`, `afterToolCall`, `onCompaction` extension points
- **Session mutex** — per-session write locks for safe concurrent access

### Tools & Permissions
- **Built-in tools** — `read_file`, `list_directory`, `write_file`, `run_shell`, `read_web_page`, `append_daily_memory`
- **Memory tools** — `memory_search` (full-text search), `memory_get` (read a specific file), `load_skill` (on-demand SKILL.md loading)
- **Risk-based permission policy** — low / medium / high / blocked; `observe` / `confirm` / `auto` modes
- **Tool profiles** — `coding`, `full`, `messaging`, `background` capability sets per session
- **Sandbox enforcement** — shell tool can be scoped to workspace root, rejecting path traversal
- **Approval prompts** — interactive approval in both CLI and Web UI

### Context & Memory
- **XML-section system prompt** — identity, runtime, tooling, safety, skills, workspace sections
- **Prompt caching** — Anthropic `cache_control: ephemeral` on system blocks
- **Workspace bootstrap files** — `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`
- **Daily memory** — `append_daily_memory` tool for persistent notes
- **Session persistence** — JSONL-backed session and trace storage

### Skills
- **SKILL.md format** — `name` + `description` frontmatter, full body on demand
- **Precedence** — workspace > user (`~/.arvinclaw/skills/`) > built-in
- **Skill management** — install, enable, disable, trust, review via CLI

### Adapters
- **CLI** — Ink-based terminal UI with streaming, approval prompts, todos panel
- **Web UI** — Hono API server + React frontend; sessions list, streaming chat, approval modal
- **Cross-adapter sessions** — CLI and Web share the same `JsonlSessionStore`
- **Session Gateway** — `packages/gateway` tracks active sessions across adapters

### Background Automation
- **One-shot tasks** — `arvinclaw run "<goal>" [--mode auto|confirm]`
- **Cron daemon** — `arvinclaw daemon` runs scheduled tasks from `tasks/*.task.json`
- **TaskFlow** — persistent cross-session task graph with 8 statuses and parent/child relationships
- **Background approval policy** — `BackgroundApprovalResolver` auto-approves or auto-denies
- **Task history** — `arvinclaw tasks` and `arvinclaw taskflow list/show/cancel`
- **Memory dreaming** — `arvinclaw run --dream` consolidates daily notes into `MEMORY.md`

### Model Providers
- **OpenAI-compatible** — any API following OpenAI chat completions (OpenAI, OpenRouter, Ollama, etc.)
- **Anthropic** — native SDK with prompt caching, streaming, and extended thinking
- **Thinking budget** — `off` / `minimal` / `low` / `medium` / `high` / `max` / `adaptive` for Anthropic reasoning depth

---

## Quick Start

**Requirements:** Node.js ≥ 22, pnpm

```bash
git clone https://github.com/your-username/arvinclaw
cd arvinclaw
pnpm install
pnpm run check        # typecheck + tests + docs parity check
```

Set your API key (choose one):

```bash
# Anthropic (uses claude-haiku-4-5 by default)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter (model must be explicit)
export OPENROUTER_API_KEY=sk-or-...
export ARVINCLAW_MODEL=openai/gpt-4o

# Any OpenAI-compatible endpoint
export ARVINCLAW_API_KEY=...
export ARVINCLAW_BASE_URL=https://your-provider/v1
export ARVINCLAW_MODEL=your-model-name
```

Start chatting:

```bash
pnpm --filter @arvinclaw/cli start chat
# or after building:
arvinclaw chat
```

---

## Usage

### CLI

```bash
arvinclaw chat                          # Start interactive streaming chat (Ink UI)
arvinclaw chat --session <id>           # Named session
arvinclaw chat --resume                 # Resume most recent session
arvinclaw run "<goal>"                  # One-shot background task (default: confirm mode)
arvinclaw run "<goal>" --mode auto      # Auto-approve low/medium risk tools
arvinclaw tasks                         # List recent background task runs
arvinclaw tasks --limit 5
arvinclaw sessions                      # List stored sessions
arvinclaw skills                        # List loaded skills with trust status
arvinclaw skills install <path>         # Install a skill from a .md file
arvinclaw skills enable <name>
arvinclaw skills disable <name>
arvinclaw skills trust <name>
arvinclaw skills review <name>
arvinclaw daemon                        # Start the cron scheduler daemon
arvinclaw taskflow list                 # List all task flow records
arvinclaw taskflow show <id>            # Show a specific task
arvinclaw taskflow cancel <id>          # Cancel a running task
arvinclaw run "<goal>" --dream          # Memory dreaming — consolidate daily notes
```

### Web UI

```bash
pnpm --filter @arvinclaw/web run dev    # Hono on :3120, Vite on :5173
```

Open `http://localhost:5173` in your browser. Create or resume sessions, send messages, watch streaming responses, approve tool actions.

API endpoints:
- `POST /api/sessions` — create or resume a session
- `GET /api/sessions` — list sessions
- `POST /api/sessions/:id/turns` — run a turn (SSE stream)
- `POST /api/sessions/:id/approvals` — resolve a pending approval
- `GET /api/gateway/sessions` — active sessions across all adapters
- `GET /ws/:id` — WebSocket connection for bidirectional communication

---

## Architecture

ArvinClaw is a pnpm monorepo. Packages own a single responsibility. Adapters wire them together.

```
packages/
  config/       Configuration loading, env overrides, resolveSessionsDirectory
  context/      System prompt assembly (XML sections), prompt caching
  core/         AgentRuntime, event system, spawn_subagent, streaming
  models/       OpenAI-compatible + Anthropic providers, streaming
  permissions/  Risk-based permission policy, autonomy modes
  sessions/     JSONL session + trace storage
  skills/       SKILL.md parser, SkillLoader, SkillManager
  tools/        Built-in tools, load_skill, memory_search, memory_get
  adapters/     AdapterCapabilities interface, CLI/Web/Background constants
  scheduler/    BackgroundApprovalResolver, JsonlTaskStore, CronScheduler
  taskflow/     TaskRecord, JsonlTaskFlowStore — persistent task graph
  gateway/      SessionGateway — cross-adapter session registry

apps/
  cli/          Ink-based terminal adapter (streaming, approval, todos)
  web/          Hono server + React frontend (SSE, approval modal, sessions page)
```

**Dependency rules:** Core packages do not import from apps. The adapter layer wires everything. No circular dependencies.

---

## Configuration

All settings are optional. ArvinClaw has safe defaults.

| Environment Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Use Anthropic provider (claude-haiku-4-5) | — |
| `OPENROUTER_API_KEY` | Use OpenRouter (requires `ARVINCLAW_MODEL`) | — |
| `ARVINCLAW_API_KEY` | Generic API key | — |
| `ARVINCLAW_BASE_URL` | Provider base URL | `https://api.openai.com/v1` |
| `ARVINCLAW_MODEL` | Model name | `gpt-4.1-mini` |
| `ARVINCLAW_DEFAULT_MODE` | Autonomy mode: `observe` / `confirm` / `auto` | `confirm` |
| `ARVINCLAW_WORKSPACE_ROOT` | Working directory | `.` |
| `ARVINCLAW_LONG_TERM_MEMORY` | Memory policy: `disabled` / `read-only` / `write` | `disabled` |
| `ARVINCLAW_PROMPT_MODE` | Prompt rendering: `full` / `minimal` / `none` | `full` |
| `ARVINCLAW_EXECUTION_CONTRACT` | Execution discipline: `default` / `strict-agentic` | `default` |
| `ARVINCLAW_TOOL_PROFILE` | Tool capability set: `coding` / `full` / `messaging` / `background` | `full` |
| `ARVINCLAW_SANDBOX` | Restrict shell to workspace root: `true` / `false` | `false` |
| `ARVINCLAW_THINKING_BUDGET` | Anthropic reasoning depth: `off` / `minimal` / `low` / `medium` / `high` / `max` / `adaptive` | `adaptive` |

File-based config: `arvinclaw.config.json` (project) and `~/.arvinclaw/config.json` (user).

---

## Development

```bash
pnpm install          # install all dependencies
pnpm run check        # typecheck + vitest + docs parity check
pnpm run typecheck    # TypeScript only
pnpm run test         # vitest only
pnpm run docs:check   # heading count parity (EN ↔ zh-CN)
```

### Adding a tool

1. Add an `ExecutableTool` factory in `packages/tools/src/index.ts`
2. Add a result type to `ToolExecutionResult` union
3. Register it in the appropriate adapter (`apps/cli` or `apps/web`)
4. Add tests in `packages/tools/src/index.test.ts`

### Adding a provider

1. Implement `ModelProvider` (or `StreamingModelProvider`) in `packages/models/src/index.ts`
2. Add config wiring in `packages/config/src/index.ts`
3. Add tests with an injectable fake client

---

## Documentation

| Document | Description |
|---|---|
| [Roadmap](./docs/roadmap/overview.md) | Phase plan, completion status |
| [Architecture docs](./docs/architecture/) | One doc per module |
| [Decisions](./docs/decisions/) | ADRs for key design choices |
| [Plans](./docs/plans/) | Per-phase implementation plans |
| [Research](./docs/research/) | OpenClaw implementation notes |

All documentation exists in English and Simplified Chinese.

---

## OpenClaw Alignment

ArvinClaw is architecturally aligned with OpenClaw but not identical. See [Decision 0002](./docs/decisions/0002-openclaw-aligned-not-identical.md) for the rationale.

Current alignment:

| OpenClaw Capability | ArvinClaw Status |
|---|---|
| Agent loop (intake → inference → tools → persist) | ✅ Complete |
| XML-section system prompt | ✅ Complete |
| Prompt caching | ✅ Anthropic `cache_control` |
| `update_plan` / in-turn task tracking | ✅ `update_todos` tool |
| Planning stall detection + retry injection | ✅ Complete |
| Streaming output | ✅ SSE + `token_delta` events |
| SKILL.md format + skill index | ✅ Complete |
| Workspace bootstrap files | ✅ AGENTS.md, SOUL.md, USER.md, MEMORY.md, daily notes |
| Session persistence | ✅ JSONL store |
| Multi-adapter (CLI + Web) | ✅ Shared `AgentRuntime` |
| `sessions_spawn` sub-agents | ✅ `spawn_subagent` tool |
| Background tasks | ✅ `arvinclaw run` |
| Skill install / trust / permissions | ✅ Phase 9 |
| Session gateway | ✅ `packages/gateway` |
| Context compaction | ✅ `compactMessages()` in `packages/context` |
| Skill body on-demand loading | ✅ `load_skill` tool |
| `memory_search` / `memory_get` tools | ✅ `packages/tools` |
| Prompt modes (full / minimal / none) | ✅ `ARVINCLAW_PROMPT_MODE` |
| Strict-agentic execution contract | ✅ `ARVINCLAW_EXECUTION_CONTRACT` |
| Per-session write locks | ✅ `SessionMutex` in `packages/core` |
| Hooks system | ✅ `AgentHooks` in `packages/core` |
| Tool profiles | ✅ `ARVINCLAW_TOOL_PROFILE` |
| Sandbox enforcement | ✅ `ARVINCLAW_SANDBOX` |
| Cron daemon | ✅ `arvinclaw daemon` |
| TaskFlow (persistent task graph) | ✅ `packages/taskflow` |
| Async subagents | ✅ `spawn_subagent_async` tool |
| WebSocket support | ✅ `GET /ws/:id` |
| Thinking budget | ✅ `ARVINCLAW_THINKING_BUDGET` |
| Memory dreaming | ✅ `arvinclaw run --dream` |

All 18 OpenClaw alignment gaps are closed. See [OpenClaw Alignment Plan](./docs/plans/openclaw-alignment.md) for implementation details.

---

## License

MIT

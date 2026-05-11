# Vole

> A personal general-purpose agent — OpenClaw-inspired, TypeScript, real and usable.

[![npm](https://img.shields.io/npm/v/vole-agent?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/vole-agent)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Tests](https://img.shields.io/badge/tests-419%20passing-22c55e)](#development)

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

---

## What is Vole?

Vole is a personal general-purpose agent built from first principles in TypeScript.

It is both a **real, usable product** and an **architecture learning project**. Every module — agent loop, tool execution, permission policy, context assembly, session storage, streaming, and multi-agent coordination — is implemented deliberately, documented thoroughly, and tested. The reference architecture is [OpenClaw](https://openclaw.ai).

---

## Features

### Agent Core
- **Agent loop** — context assembly → model inference → tool execution → streaming replies → persistence
- **Streaming output** — token-by-token via SSE (Web) and progressive text output (CLI)
- **Planning stall detection** — detects plan-only turns and forces immediate action via retry injection
- **In-turn task tracking** — model-callable `update_todos` (equivalent to OpenClaw `update_plan`)
- **Sub-agent spawning** — `spawn_subagent` (blocking) and `spawn_subagent_async` (fire-and-forget)
- **Context compaction** — automatic conversation summarization before context overflow
- **Execution contracts** — `default` and `strict-agentic` modes for planning discipline
- **Hooks** — `beforeTurn`, `beforeToolCall`, `onCompaction` and more extension points
- **Session mutex** — per-session write locks for safe concurrent access

### Tools & Permissions
- **Built-in tools** — `read_file`, `list_directory`, `write_file`, `edit_file`, `run_shell`, `read_web_page`, `search_files`
- **Memory tools** — `memory_search`, `memory_get`, `append_daily_memory`, `update_heartbeat`
- **Skill loading** — `load_skill` loads full SKILL.md body on demand
- **Risk-based permission policy** — low / medium / high / blocked; `observe` / `confirm` / `auto` modes
- **Tool profiles** — `coding`, `full`, `messaging`, `background` capability sets per session
- **Sandbox enforcement** — shell tool can be scoped to workspace root, rejecting path traversal

### Context & Memory
- **XML-section system prompt** — identity, runtime, tooling, safety, skills, workspace sections
- **Prompt caching** — Anthropic `cache_control: ephemeral` on system blocks
- **Workspace bootstrap files** — `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`
- **Session persistence** — JSONL-backed message and trace storage with compaction boundary support

### Skills
- **SKILL.md format** — `name` + `description` frontmatter; full body loaded on demand via `load_skill`
- **Three-source precedence** — workspace > user (`~/.vole/skills/`) > built-in
- **Lifecycle management** — install, enable, disable, trust, review via CLI

### Adapters
- **CLI** — terminal adapter with streaming, interactive approval prompts, slash commands, and daemon
- **Web UI** — Hono API + React frontend; sessions list, streaming chat, inline approval modal
- **Cross-adapter sessions** — CLI and Web share the same `JsonlSessionStore`
- **Session gateway** — `packages/gateway` tracks active sessions across adapters

### Background Automation
- **One-shot tasks** — `vole run "<goal>" [--mode auto|confirm]`
- **Cron daemon** — `vole daemon` runs scheduled tasks from `tasks/*.task.json`
- **Heartbeat** — daemon writes `HEARTBEAT.md` at task start/end; agent can call `update_heartbeat`
- **TaskFlow** — persistent cross-session task graph with 8 statuses and parent/child relationships
- **Memory dreaming** — `vole run --dream` consolidates daily notes into `MEMORY.md`

### Model Providers
- **OpenAI-compatible** — any API following OpenAI chat completions (OpenAI, OpenRouter, Ollama, etc.)
- **Anthropic** — native SDK with prompt caching, streaming, and extended thinking
- **Thinking budget** — `off` / `minimal` / `low` / `medium` / `high` / `max` / `adaptive`

---

## Quick Start

### Install (end users)

```bash
npm install -g vole-agent
vole              # bare `vole` defaults to interactive chat in a real terminal
vole chat         # explicit form, identical behavior
```

On first run, Vole will prompt you to configure an API key. You can set one in `~/.vole/config.json`:

```json
{ "apiKey": "sk-ant-..." }
```

Or via environment variables (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `VOLE_API_KEY`).

### From source (contributors)

**Requirements:** Node.js ≥ 22, pnpm

```bash
git clone https://github.com/your-username/vole
cd vole
pnpm install
cp .env.example .env   # fill in your API key
```

> **Alternative to `.env`**: `~/.vole/config.json` is loaded automatically and works for API keys too (e.g. `{ "apiKey": "sk-ant-..." }`). Useful if you prefer not to manage per-project `.env` files.

Minimal `.env` for OpenRouter:

```bash
OPENROUTER_API_KEY=sk-or-...
VOLE_MODEL=anthropic/claude-3-haiku
```

Or for Anthropic directly:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**Start chatting** (no build step required):

```bash
pnpm cli -- chat
```

---

## Usage

### CLI

The `pnpm cli --` shortcut runs the CLI directly from source — no build step needed during development.

```bash
pnpm cli                                   # bare invocation → interactive chat (TTY)
pnpm cli -- chat                           # interactive chat
pnpm cli -- chat --resume                  # resume most recent session
pnpm cli -- chat --session <id>            # named session
pnpm cli -- run "<goal>"                   # one-shot background task (confirm mode)
pnpm cli -- run "<goal>" --mode auto       # auto-approve low/medium risk tools
pnpm cli -- run --dream                    # consolidate daily notes into MEMORY.md
pnpm cli -- sessions                       # list stored sessions
pnpm cli -- tasks                          # list recent background task runs
pnpm cli -- skills                         # list loaded skills with trust status
pnpm cli -- skills install <path>          # install a skill from a .md file
pnpm cli -- skills trust <name>            # mark a skill as trusted
pnpm cli -- daemon                         # start the cron scheduler daemon
pnpm cli -- web                            # open web dashboard (requires web build)
pnpm cli -- taskflow list                  # list task flow records
pnpm cli -- taskflow show <id>
pnpm cli -- taskflow cancel <id>
```

### Web UI

```bash
# Development (hot reload)
pnpm --filter @vole/web run dev   # Hono on :3120, Vite on :5173

# Installed (after npm install -g vole-agent)
vole web                           # opens http://localhost:3120
pnpm cli -- web                   # same, from source
```

Open `http://localhost:5173` (dev) or `http://localhost:3120` (installed). Create or resume sessions, send messages, watch streaming responses, stop in-progress turns, and approve tool actions from the browser.

REST + SSE API:

```
POST   /api/sessions              create or resume a session
GET    /api/sessions              list all sessions
POST   /api/sessions/:id/turns    run a turn — response is an SSE stream of runtime events
POST   /api/sessions/:id/approvals resolve a pending tool approval
GET    /api/gateway/sessions      active sessions in this process
GET    /ws/:id                    WebSocket — bidirectional alternative to SSE
```

---

## Architecture

Vole is a pnpm monorepo with 12 packages and 2 adapter apps, organized into four strict layers. Nothing in the core imports from adapters. No circular dependencies.

### Packages

```
Adapter Layer
  apps/cli/          terminal adapter — wires all dependencies, drives interactive loop
  apps/web/          Hono + React adapter — REST/SSE/WebSocket, approval modal

Infrastructure Layer (stateless services & storage)
  packages/config/       EffectiveConfig, env loading, provider shortcuts, redaction
  packages/sessions/     JSONL message + trace storage, session mutex, compaction boundary
  packages/skills/       SKILL.md parser, SkillLoader (3-source), SkillManager lifecycle
  packages/scheduler/    CronScheduler, BackgroundApprovalResolver, JsonlTaskStore, writeHeartbeat
  packages/taskflow/     JsonlTaskFlowStore — persistent cross-session task graph
  packages/gateway/      SessionGateway — in-process active session registry
  packages/adapters/     AdapterCapabilities, ToolProfile, filterToolsByProfile

Agent Core Layer (turn orchestration)
  packages/core/         AgentRuntime, 17-event async generator, hooks, spawn_subagent
  packages/context/      DefaultContextAssembler, XML sections, PromptMode, compactMessages
  packages/permissions/  DefaultPermissionPolicy — risk × autonomy mode → allow/ask/deny
  packages/tools/        all built-in tools, sandbox enforcement, memory tools

Model Provider Layer (vendor abstraction)
  packages/models/       OpenAICompatibleProvider, AnthropicProvider, streaming, thinking budget
```

### Dependency Rules

- **Adapters** own all wiring — they create `AgentRuntime` and inject every dependency.
- **`core`** depends only on `context`, `permissions`, `tools`, and the `ModelProvider` interface. It never imports from apps or infrastructure packages.
- **Infrastructure packages** are standalone — they do not import from `core`.
- **`models`** is the deepest package; nothing it imports knows about agent logic.

### Package Documentation

Each package has a detailed README covering architecture, core concepts, implementation principles, and design decisions.

| Package | Role | README |
|---|---|---|
| `packages/core` | Agent loop, event system, hooks, subagent spawning | [README](./packages/core/README.md) |
| `packages/context` | System prompt assembly, PromptMode, compactMessages | [README](./packages/context/README.md) |
| `packages/models` | ModelProvider, Anthropic + OpenAI-compatible providers, streaming | [README](./packages/models/README.md) |
| `packages/tools` | Built-in tools, workspace boundary, sandbox, memory tools | [README](./packages/tools/README.md) |
| `packages/permissions` | Risk-based permission policy, autonomy modes | [README](./packages/permissions/README.md) |
| `packages/sessions` | JSONL session and trace storage, replay, compaction | [README](./packages/sessions/README.md) |
| `packages/skills` | SKILL.md parser, SkillLoader, SkillManager lifecycle | [README](./packages/skills/README.md) |
| `packages/adapters` | AdapterCapabilities, ToolProfile, filterToolsByProfile | [README](./packages/adapters/README.md) |
| `packages/config` | Config loading, env vars, provider shortcuts, redaction | [README](./packages/config/README.md) |
| `packages/scheduler` | CronScheduler, BackgroundApprovalResolver, writeHeartbeat | [README](./packages/scheduler/README.md) |
| `packages/taskflow` | Persistent cross-session task graph, TaskRecord | [README](./packages/taskflow/README.md) |
| `packages/gateway` | SessionGateway — cross-adapter active session registry | [README](./packages/gateway/README.md) |

---

## Learning

Vole is also an architecture learning project. The `docs/learning/` directory contains 15 bilingual module docs covering every package — design decisions, implementation walkthrough, OpenClaw alignment, and review questions.

Start with the **[Learning Guide](./docs/learning/guide.md)** for the recommended reading order, or jump directly to any module below.

**Stage 1 — Mental Model**

| Doc | Topic |
|---|---|
| [01 — Agent Loop Concepts](./docs/learning/01-concepts.md) | The big picture: what an agent loop is and how the pieces fit |

**Stage 2 — Core Loop**

| Doc | Topic |
|---|---|
| [02 — Core Loop in Code](./docs/learning/02-core.md) | `AgentRuntime`, the 17-event async generator, stall detection |

**Stage 3 — Foundation Modules**

| Doc | Topic |
|---|---|
| [03 — Config](./docs/learning/03-config.md) | Env loading, three-layer merge, `EffectiveConfig`, redaction |
| [04 — Models](./docs/learning/04-models.md) | `ModelProvider`, streaming, Anthropic vs OpenAI-compatible |
| [05 — Permissions](./docs/learning/05-permissions.md) | Risk × autonomy mode → allow / ask / deny / block |
| [06 — Tools](./docs/learning/06-tools.md) | Tool registry, sandbox, workspace boundary, result types |
| [07 — Context](./docs/learning/07-context.md) | XML sections, prompt modes, `compactMessages`, cache hints |
| [08 — Sessions](./docs/learning/08-sessions.md) | JSONL append, `#replay`, compaction boundary, mutex |
| [09 — Taskflow](./docs/learning/09-taskflow.md) | `update_todos`, `TodoItem` state machine, `JsonlTaskFlowStore` |
| [10 — Skills](./docs/learning/10-skills.md) | Three-source loading, progressive disclosure, `SkillManager` |
| [11 — Scheduler](./docs/learning/11-scheduler.md) | `CronScheduler`, `BackgroundApprovalResolver`, `writeHeartbeat` |

**Stage 4 — Extension Systems**

| Doc | Topic |
|---|---|
| [12 — Adapters](./docs/learning/12-adapters.md) | `AdapterCapabilities`, tool profiles, `filterToolsByProfile` |
| [13 — Gateway](./docs/learning/13-gateway.md) | In-process session registry, `touch`, presence vs. history |

**Stage 5 — System Synthesis**

| Doc | Topic |
|---|---|
| [14 — CLI](./docs/learning/14-cli.md) | How all packages are wired together; `CliChatSession`, `sendMessage` |
| [15 — Web](./docs/learning/15-web.md) | `WebApprovalResolver` Promise bridge, SSE vs WebSocket, two storage tiers |

All learning docs exist in English and Simplified Chinese.

---

## Configuration

All settings are optional. Vole has safe defaults.

| Environment Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Use Anthropic provider (claude-haiku-4-5) | — |
| `OPENROUTER_API_KEY` | Use OpenRouter (requires `VOLE_MODEL`) | — |
| `VOLE_API_KEY` | Generic API key override | — |
| `VOLE_BASE_URL` | Provider base URL | `https://api.openai.com/v1` |
| `VOLE_MODEL` | Model name | `gpt-4.1-mini` |
| `VOLE_DEFAULT_MODE` | Autonomy mode: `observe` / `confirm` / `auto` | `confirm` |
| `VOLE_WORKSPACE_ROOT` | Working directory | `.` |
| `VOLE_LONG_TERM_MEMORY` | Memory policy: `disabled` / `read-only` / `write` | `disabled` |
| `VOLE_PROMPT_MODE` | Prompt rendering: `full` / `minimal` / `none` | `full` |
| `VOLE_EXECUTION_CONTRACT` | Execution discipline: `default` / `strict-agentic` | `default` |
| `VOLE_TOOL_PROFILE` | Tool capability set: `coding` / `full` / `messaging` / `background` | `full` |
| `VOLE_SANDBOX` | Restrict shell to workspace root: `true` / `false` | `false` |
| `VOLE_THINKING_BUDGET` | Anthropic reasoning depth: `off` / `minimal` … `max` / `adaptive` | `adaptive` |

**File-based config** (recommended for installed users):

```json
// ~/.vole/config.json  — user-level, applied to all projects
{ "apiKey": "sk-ant-...", "model": "claude-haiku-4-5" }

// vole.config.json  — project-level, checked into the repo
{ "defaultMode": "auto", "sandbox": true }
```

File config is loaded automatically. Environment variables override file values.

---

## Development

### Local Setup

```bash
pnpm install          # install all dependencies
cp .env.example .env  # fill in your API key (or use ~/.vole/config.json)
pnpm chat             # interactive chat — mirrors `vole chat` after install
pnpm web              # web UI dev server — mirrors `vole web` after install
                      #   Hono API: http://localhost:3120
                      #   Vite dev: http://localhost:5173 (hot reload)
```

The workspace root defaults to the current directory — run `pnpm chat` from your project folder just like you would run `vole chat` after installing.

### Tests and Checks

```bash
pnpm run check        # typecheck + vitest + bilingual docs parity (run before every commit)
pnpm run typecheck    # TypeScript only
pnpm run test         # vitest only
pnpm run test:watch   # vitest in watch mode
pnpm run docs:check   # heading count parity (EN ↔ zh-CN)
pnpm run check:bundle # build + smoke test the bundled output (run before publishing)
```

### Building for Production

```bash
pnpm run build
node apps/cli/dist/index.js chat
pnpm --filter @vole/web run start
```

### Contributing

**Adding a tool**: implement an `ExecutableTool` factory in `packages/tools/src/index.ts`, add its result type to the `ToolExecutionResult` union, register it in the relevant adapter, and add tests.

**Adding a provider**: implement `ModelProvider` (or `StreamingModelProvider`) in `packages/models/src/index.ts`, add config wiring in `packages/config/src/index.ts`, and add tests with an injectable fake client.

---

## Documentation

| Document | Description |
|---|---|
| [Learning Guide](./docs/learning/guide.md) | Stage-based curriculum for studying the codebase |
| [Roadmap](./docs/roadmap/overview.md) | Phase plan and completion status |
| [Architecture docs](./docs/architecture/) | One doc per architectural concern |
| [Decisions](./docs/decisions/) | ADRs for key design choices |
| [Research](./docs/research/) | OpenClaw implementation notes |

All documentation exists in English and Simplified Chinese.

---

## License

MIT

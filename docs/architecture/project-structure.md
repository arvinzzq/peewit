# Project Structure

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [project-structure.zh-CN.md](./project-structure.zh-CN.md)

## 1. Purpose

Peewit uses a lightweight monorepo so the project can grow from a CLI MVP into a multi-entry agent platform without rewriting the core architecture.

The structure should make one rule obvious:

The Agent Core owns agent behavior. User interfaces only adapt user input and output to the core.

This matters because Peewit is expected to support CLI first, then Web UI, desktop app, messaging platforms, and background automation. If the first CLI implementation owns too much logic, every later entry point would need to duplicate or reverse-engineer that behavior.

## 2. Current Layout

```text
apps/
  cli/          terminal adapter (Ink + readline)
  web/          web adapter (Hono + SSE + WebSocket)
packages/
  core/         agent runtime and event loop
  config/       configuration loading and validation
  context/      prompt and context assembly
  models/       model provider abstractions and implementations
  tools/        tool definitions and execution
  skills/       skill discovery, parsing, and lifecycle
  permissions/  risk classification and approval policy
  sessions/     session and trace persistence
  gateway/      cross-adapter session registry
  adapters/     capability constants and tool profile filtering
  taskflow/     cross-session task graph persistence
  scheduler/    background task runner and cron scheduler
docs/
  architecture/
  roadmap/
  plans/
  product/
  decisions/
  research/
scripts/
tests/
skills/
```

## 3. Directory Responsibilities

### `apps/cli`

The CLI app owns terminal interaction:

- Parsing CLI commands and routing to `chat`, `run`, `sessions`, `tasks`, `skills`, `daemon`, `taskflow`
- Rendering messages, traces, and permission prompts via Ink (React-based terminal UI)
- Reading user confirmation from the terminal
- Composing all runtime dependencies and creating `AgentRuntime`

The CLI should not own agent planning, tool selection, permission decisions, skill loading, model provider logic, or session persistence rules.

### `apps/web`

The web app owns browser-based interaction:

- HTTP REST API for session lifecycle (`POST /api/sessions`, `GET /api/sessions`)
- SSE streaming for turn events (`POST /api/sessions/:id/turns`)
- WebSocket endpoint (`/ws/:id`) for bidirectional session communication
- Approval resolution endpoint (`POST /api/sessions/:id/approvals`)
- Gateway sessions endpoint (`GET /api/gateway/sessions`)

The web adapter shares the same `AgentRuntime` as the CLI. It does not reimplement agent behavior.

### `packages/core`

The core package owns the agent runtime:

- Agent loop
- Task orchestration
- Conversation turn handling
- Tool call coordination
- Trace event creation
- Shared domain types

Other entry points should be able to use `packages/core` without importing CLI code.

### `packages/config`

The config package owns configuration loading, validation, precedence, and redaction:

- Built-in defaults
- User config loading
- Project config loading
- Environment variable overrides
- Effective config creation
- Secret presence checks
- Redacted config views

Other packages should receive validated configuration or configured dependencies. They should not independently read config files or environment variables.

### `packages/context`

The context package owns prompt and context assembly:

- Base system instruction assembly
- Runtime metadata projection
- Skill index projection
- Tool definition projection
- Permission guidance projection
- Session resume context projection
- Workspace file loading in later phases
- Context compaction in later phases

Prompt assembly should be testable and adapter-agnostic. CLI and Web UI should not construct prompts directly.

### `packages/models`

The models package owns model provider abstractions and implementations:

- `ModelProvider` interface
- OpenAI-compatible provider
- Future Anthropic, Gemini, Ollama, and local provider adapters

The core should depend on the provider interface, not vendor SDK details.

### `packages/tools`

The tools package owns tool definitions and tool execution wrappers:

- Tool interface
- Tool registry
- File tools
- Shell tool
- Web search tool
- Web page reader tool

Tools describe what they can do. They do not decide whether an action is allowed. Permission decisions belong to `packages/permissions`.

### `packages/permissions`

The permissions package owns risk classification and approval policy:

- Low, Medium, High, and Blocked risk levels
- Permission policy evaluation
- Autonomy mode interaction
- Approval request shape

The package should be UI-agnostic. It can say "this action requires confirmation", but the CLI or Web UI decides how to ask the user.

### `packages/skills`

The skills package owns local skill discovery and prompt integration:

- Built-in skill loading
- Project skill loading
- User skill loading
- Skill precedence
- `SKILL.md` parsing
- Skill summaries for prompt assembly

Skills can guide the agent. They cannot bypass tools or permissions.

### `packages/sessions`

The sessions package owns persistence:

- Session records
- Trace records
- Conversation history
- `InMemorySessionStore` for tests and ephemeral sessions
- `JsonlSessionStore` for file-backed durable sessions (per-session directory with `session.json`, `messages.jsonl`, `trace.jsonl`)

The interface should leave room for future backends without changing the callers.

### `packages/gateway`

The gateway package owns cross-adapter session coordination:

- `SessionGateway` in-memory registry tracking active sessions per process
- `register`, `unregister`, `touch`, `get`, `list`, `listByAdapter` operations
- `GatewaySession` records carrying adapter name, capabilities, and activity timestamps

Each adapter creates a process-level singleton and registers sessions as they start. This is the foundation for future multi-entry routing in Phase 10.

### `packages/adapters`

The adapters package owns capability declarations and tool profile filtering:

- `AdapterCapabilities` interface: `streaming`, `approvalPrompts`, `background`
- Canonical constants: `CLI_CAPABILITIES`, `WEB_CAPABILITIES`, `BACKGROUND_CAPABILITIES`
- `ToolProfile` type: `coding`, `full`, `messaging`, `background`
- `filterToolsByProfile(tools, profile)` for restricting tool sets per use case

This package has no runtime dependencies — it exports pure type definitions and constants only.

### `packages/taskflow`

The taskflow package owns cross-session task graph persistence:

- `TaskRecord` with status lifecycle: `queued → running → waiting → blocked → succeeded/failed/cancelled/lost`
- `TaskRuntime` tags: `subagent`, `background`, `cli`, `cron`, `web`
- Parent/child task relationships via `parentId`
- `JsonlTaskFlowStore` backed by a single JSONL file
- `list`, `get`, `create`, `update` operations

This is distinct from the per-session `update_todos` tool. TaskFlow records persist across sessions and represent the agent's durable task graph.

### `packages/scheduler`

The scheduler package owns background task execution:

- `TaskDefinition` format loaded from `*.task.json` files
- `JsonlTaskStore` for per-run task execution history
- `BackgroundApprovalResolver`: auto-approves in `auto` mode, auto-denies otherwise (no user present)
- `CronScheduler`: checks cron expressions on a one-minute interval, calls runner for due tasks
- `matchesCron(expr, date)` utility for standard 5-field cron expressions

The scheduler composes with `AgentRuntime` at the CLI adapter layer. It does not own agent behavior.

### `docs`

The docs directory owns product and learning documentation:

- Product design
- Roadmap
- Architecture explanations
- Future implementation plans

The documentation is part of the product goal. Peewit should be useful to run and useful to study.

### `skills`

The root `skills` directory contains project-local skills. These should override user and built-in skills with the same name.

## 4. Dependency Direction

Dependencies flow inward from adapters toward the core:

```text
apps/cli ──────────────────────────────────────────┐
apps/web ──────────────────────────────────────────┤
         │                                          │
         ├──▶ @peewit/core ◀── @peewit/scheduler
         │         │
         │         ├──▶ @peewit/context ──▶ @peewit/models
         │         ├──▶ @peewit/models
         │         ├──▶ @peewit/permissions
         │         └──▶ @peewit/tools
         │
         ├──▶ @peewit/config
         ├──▶ @peewit/sessions
         ├──▶ @peewit/gateway ──▶ @peewit/adapters
         ├──▶ @peewit/adapters
         ├──▶ @peewit/skills
         ├──▶ @peewit/taskflow
         └──▶ @peewit/scheduler ──▶ @peewit/core (types only)
```

Hard boundaries — these must never be crossed:

| Package | Must NOT import |
| --- | --- |
| `core` | `apps/cli`, `apps/web`, any adapter code |
| `context` | `core`, `permissions`, `tools` |
| `models` | `core`, `context`, `tools` |
| `tools` | `core`, `context`, `permissions` |
| `permissions` | any internal package |
| `sessions` | any internal package |
| `adapters` | any internal package |

The `apps/` adapters wire everything together. All internal packages stay entry-point agnostic.

## 5. Adapter Pattern

Each user entry point should eventually become an adapter over the same core runtime.

Examples:

- CLI adapter: terminal input, terminal output, terminal confirmation prompts
- Web adapter: HTTP or WebSocket input, browser-rendered trace, browser approval UI
- Desktop adapter: local app shell, native notifications, OS integrations
- Messaging adapter: message events, channel-specific formatting, async approvals
- Background adapter: scheduled events, stored task definitions, persistent traces

Adapters can differ in presentation and interaction timing, but they should not redefine agent behavior.

## 6. Why Not a Single Package

A single `src/` package would be faster for the first few files, but it would blur boundaries early:

- CLI concerns could leak into core logic.
- Tool logic could mix with permission prompts.
- Model vendor details could spread across the runtime.
- Later Web UI work could require restructuring instead of extension.

The lightweight monorepo avoids this without committing to heavy release infrastructure.

## 7. Why Not a Heavy Monorepo

Peewit should not start with complex publishing, release automation, or package governance.

The MVP needs clear boundaries, not ceremony. The monorepo should stay lightweight until the project has real pressure for more tooling.

## 8. Phase 0 Acceptance Criteria

Phase 0 should be considered complete when:

- The agreed directory structure exists.
- A root README explains Peewit's product and learning goals.
- The main design document links to the roadmap.
- This project structure document explains package responsibilities.
- The initial package layout makes it possible to add CLI without coupling Agent Core to CLI.

## 9. Related Documents

- [Main design](../product/peewit-design.md)
- [Roadmap](../roadmap/overview.md)
- [CLI adapter](./cli-adapter.md)
- [Configuration system](./configuration-system.md)

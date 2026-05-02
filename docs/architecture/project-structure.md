# Project Structure

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [project-structure.zh-CN.md](./project-structure.zh-CN.md)

## 1. Purpose

ArvinClaw uses a lightweight monorepo so the project can grow from a CLI MVP into a multi-entry agent platform without rewriting the core architecture.

The structure should make one rule obvious:

The Agent Core owns agent behavior. User interfaces only adapt user input and output to the core.

This matters because ArvinClaw is expected to support CLI first, then Web UI, desktop app, messaging platforms, and background automation. If the first CLI implementation owns too much logic, every later entry point would need to duplicate or reverse-engineer that behavior.

## 2. Proposed Layout

```text
apps/
  cli/
packages/
  core/
  config/
  context/
  models/
  tools/
  skills/
  permissions/
  sessions/
docs/
  architecture/
  roadmap/
  superpowers/specs/
skills/
```

## 3. Directory Responsibilities

### `apps/cli`

The CLI app owns terminal interaction:

- Parsing CLI commands
- Running `arvinclaw chat`
- Running future `arvinclaw run "<goal>"`
- Rendering messages, traces, and permission prompts
- Reading user confirmation from the terminal

The CLI should not own agent planning, tool selection, permission decisions, skill loading, model provider logic, or session persistence rules.

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
- Future memory storage adapters

The first implementation can be simple local storage, but the interface should leave room for future backends.

### `docs`

The docs directory owns product and learning documentation:

- Product design
- Roadmap
- Architecture explanations
- Future implementation plans

The documentation is part of the product goal. ArvinClaw should be useful to run and useful to study.

### `skills`

The root `skills` directory contains project-local skills. These should override user and built-in skills with the same name.

## 4. Dependency Direction

Dependencies should generally flow inward:

```text
apps/* -> packages/{config,core} -> packages/{models,tools,skills,permissions,sessions}
```

Important boundaries:

- `packages/core` must not import from `apps/cli`.
- `packages/config` must not import from `apps/cli`.
- `packages/models` must not import from `apps/cli`.
- `packages/tools` must not import from `apps/cli`.
- `packages/permissions` must not import from `apps/cli`.
- `packages/skills` must not import from `apps/cli`.
- `packages/sessions` must not import from `apps/cli`.

The CLI can depend on core packages, but core packages must stay entry-point agnostic.

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

ArvinClaw should not start with complex publishing, release automation, or package governance.

The MVP needs clear boundaries, not ceremony. The monorepo should stay lightweight until the project has real pressure for more tooling.

## 8. Phase 0 Acceptance Criteria

Phase 0 should be considered complete when:

- The agreed directory structure exists.
- A root README explains ArvinClaw's product and learning goals.
- The main design document links to the roadmap.
- This project structure document explains package responsibilities.
- The initial package layout makes it possible to add CLI without coupling Agent Core to CLI.

## 9. Related Documents

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [CLI adapter](./cli-adapter.md)
- [Configuration system](./configuration-system.md)

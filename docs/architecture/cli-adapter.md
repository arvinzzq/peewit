# CLI Adapter

Status: Active
Date: 2026-05-11

Simplified Chinese version: [cli-adapter.zh-CN.md](./cli-adapter.zh-CN.md)

## 1. Purpose

The CLI adapter is the first user-facing product surface for Vole.

It lets the user start conversations, send goals, approve actions, inspect traces, resume sessions, and learn how the agent works from a terminal.

The key boundary:

The CLI owns interaction. Agent Core owns behavior.

## 2. Why This Module Exists

Vole starts with CLI because it is the smallest useful product surface and the easiest place to study agent internals.

The CLI must still be designed carefully because it will shape early architecture:

- It should not assemble prompts directly.
- It should not decide which tools the model can use.
- It should not hard-code permission policy.
- It should not persist sessions by writing raw files itself.
- It should render trace and approval state from structured core events.

This keeps the future Web UI, desktop app, and background runner from becoming separate agent implementations.

## 3. Product Goals

MVP CLI should support:

- Starting an interactive chat session.
- Sending one-off goals later.
- Showing model responses clearly.
- Rendering explainable trace events.
- Asking for permission when a tool action requires approval.
- Listing loaded skills when the skill system exists.
- Resuming recent sessions when session storage exists.
- Providing a learning-friendly view of what the agent is doing.

The CLI should feel like a usable tool, not only a demo wrapper.

## 4. Commands

All commands shipped through Phase 1–10. Bare invocation defaults to interactive chat in a real terminal (TTY).

Chat:

| Command | Purpose | Phase |
| --- | --- | --- |
| `vole` | Bare invocation defaults to interactive chat when stdin is a TTY | Phase 10 |
| `vole chat` | Start an interactive chat session using configured provider settings | Phase 1 |
| `vole chat --session <id>` | Start or continue a named JSONL-backed chat session | Phase 5 |
| `vole chat --resume` | Continue the most recently updated JSONL-backed chat session | Phase 5 |
| `vole chat --fake-interactive` | Interactive chat using fake provider for local testing | Phase 1 |
| `vole chat --fake "<message>"` | One-turn fake-provider smoke path | Phase 1 |
| `vole sessions` | List stored JSONL chat sessions | Phase 5 |
| `vole --version` / `-v` | Show version | Phase 0–1 |
| `vole --help` / `-h` | Show available commands | Phase 0–1 |

Background and automation:

| Command | Purpose | Phase |
| --- | --- | --- |
| `vole run "<goal>"` | Run a one-shot background task | Phase 8 |
| `vole run "<goal>" --mode auto\|confirm\|observe` | Set autonomy mode for the run | Phase 8 |
| `vole run --dream` | Consolidate daily memory notes into `MEMORY.md` | Phase 8 |
| `vole tasks [--limit N]` | List recent background task runs | Phase 8 |
| `vole daemon` | Start the cron scheduler daemon | Phase 8 |
| `vole daemon --once` | Execute all due tasks once and exit | Phase 8 |

Cross-session task graph:

| Command | Purpose | Phase |
| --- | --- | --- |
| `vole taskflow list [--limit N]` | List cross-session task records | Phase 8 |
| `vole taskflow show <id>` | Show full task record details | Phase 8 |
| `vole taskflow cancel <id>` | Mark a task as cancelled | Phase 8 |

Skills:

| Command | Purpose | Phase |
| --- | --- | --- |
| `vole skills` | List loaded skills (workspace > user > built-in) | Phase 3 |
| `vole skills install <path>` | Install a skill from a `.md` file | Phase 9 |
| `vole skills enable <name>` | Re-enable a disabled skill | Phase 9 |
| `vole skills disable <name>` | Disable an installed skill | Phase 9 |
| `vole skills trust <name>` | Mark a user-installed skill as trusted | Phase 9 |
| `vole skills review <name>` | Show full skill metadata, permissions, and body | Phase 9 |

Web UI:

| Command | Purpose | Phase |
| --- | --- | --- |
| `vole web [-p PORT]` | Start the bundled web dashboard (default port 3120) | Phase 6 |
| `vole web --no-open` | Don't auto-open the browser | Phase 6 |

## 5. Interactive Chat

`vole chat` is the primary MVP workflow.

Expected behavior:

1. Load configuration.
2. Require `VOLE_API_KEY` or `OPENROUTER_API_KEY` for the configured provider path.
3. Create or resume a lightweight session.
4. Create a run ID for each user turn.
5. Send the user message to Agent Core.
6. Stream or print assistant output.
7. Render trace events as they arrive.
8. Ask for permission when the core reports an approval request.
9. Persist session and trace data when storage exists.

Configured chat stores messages in JSONL session files under `~/.vole/sessions` by default. Named sessions use `--session <id>` and must use safe session IDs. `--resume` selects the most recently updated stored session and continues it. Default session IDs use a generic `session_<id>` shape because sessions belong to the agent, not to a specific adapter.

The CLI should not know how the prompt was assembled. It can display a summary or report produced by the context package.

## 6. Slash Commands

Inside interactive chat, slash commands provide local control without sending every instruction to the model.

MVP slash commands:

| Slash Command | Purpose |
| --- | --- |
| `/help` | Show chat controls |
| `/exit` | End the session |
| `/trace` | Show recent explainable trace events |
| `/config` | Show redacted effective configuration |
| `/skills` | List loaded skills with source and trigger condition |
| `/clear` | Clear terminal display, not session history |

Future slash commands:

| Slash Command | Purpose |
| --- | --- |
| `/context` | Show context assembly summary |
| `/session` | Show current session metadata |
| `/mode observe|confirm|auto` | Change autonomy mode when supported |
| `/model <name>` | Change model when provider switching exists |

Slash commands should be handled by the CLI adapter. They should call structured package APIs instead of editing internal state directly.

## 7. Output Model

The CLI should render four categories of output:

- Assistant messages
- Trace events
- Permission prompts
- Local command results

These categories should be visually distinct in the terminal. The exact styling can evolve, but the source data should remain structured.

MVP output should prefer clarity over decoration.

## 8. Trace Rendering

Trace output is part of the learning experience.

Default MVP behavior:

- Show compact trace events inline.
- Hide raw provider messages by default.
- Show tool names and safe summaries, not full unsafe payloads.
- Show permission decisions clearly.
- Show errors in context.

`/trace` should show recent trace details for the current session.

Later, `vole trace <session>` can inspect stored traces after a session ends.

## 9. Permission Prompts

The CLI does not decide whether an action is allowed.

Flow:

```text
Agent Core requests tool action
  -> Permission policy evaluates action
  -> Core emits approval request if needed
  -> CLI renders prompt
  -> User approves or denies
  -> CLI sends decision back to core
```

MVP prompt options:

- Approve once
- Deny
- Show details

Future options:

- Approve similar actions for this session
- Approve commands matching a project policy
- Edit tool input before approval

Approval choices must be trace-visible.

## 10. Configuration

The CLI reads configuration through a shared configuration layer.

Configuration may include:

- Model provider
- Model name
- API base URL
- Workspace path
- Default autonomy mode
- Trace verbosity
- Session storage location

Secrets should come from environment variables or a secure local secret mechanism, not from workspace prompt files.

The CLI may show effective non-secret configuration through `vole config`.

## 11. Autonomy Modes

The CLI exposes autonomy mode, but the permission package defines what the mode means.

Initial modes:

- `observe`: asks before any external action.
- `confirm`: allows low-risk actions and asks for medium or high-risk actions.
- `auto`: reduces interruptions but still respects blocked and high-risk policy.

The default MVP mode should be `confirm`.

## 12. Session Behavior

Phase 1 can start with ephemeral sessions.

When session storage exists, the CLI should support:

- Named or generated session IDs.
- Session listing.
- Session resume.
- Trace inspection.
- Consistent run IDs per turn.

The CLI should use the session package instead of writing session files directly.

## 13. Error Handling

The CLI should make recoverable errors understandable.

Examples:

- Missing API key: explain which environment variable or config value is needed.
- Provider error: show a concise reason and trace event ID if available.
- Permission denial: continue the session when possible.
- Tool failure: show safe summary and let the core decide next step.
- Invalid slash command: show local help.

Errors should be trace-visible when they happen inside an agent run.

## 14. Streaming

MVP may start with non-streaming responses if it simplifies implementation.

The interface should leave room for streaming:

- Assistant text streaming.
- Trace events arriving between tokens.
- Permission prompts interrupting a run.
- Cancellation during long operations.

Streaming should not change package boundaries.

## 15. CLI Rendering Framework

**Shipped in Phase 6.** Interactive chat (`vole chat` and bare `vole`) is rendered with **Ink** ([npmjs.com/package/ink](https://www.npmjs.com/package/ink)) — a React-based terminal UI framework. The Ink path lives in `apps/cli/src/app.tsx` and is loaded via dynamic `import()` from `main()` only when a real TTY interactive session is needed; non-interactive paths (tests, `--fake`, scripts, piped stdin, sub-commands like `sessions`/`run`) still use the readline-based code path in `apps/cli/src/index.ts`.

Why Ink:

- Streaming token output updates the same terminal region rather than printing new lines.
- Tool progress indicators (spinner, step counter) update live during multi-step runs.
- Permission prompts can be a block with risk explanation, input preview, and approval controls.
- The slash-command picker (`/resume`) renders arrow-key selectable session list.
- OpenClaw itself uses Ink, keeping us architecturally aligned.

The Ink path is contained in `apps/cli/src/app.tsx`. Agent Core, context assembly, tools, permissions, and session packages did not change. The adapter:

1. Detects whether stdin is a TTY and whether the subcommand is `chat` (or absent — bare `vole`).
2. If so, dynamically imports `./app.js` and calls `runInkChat()`.
3. Otherwise routes to the readline-based `runCli()` path for backward-compatible test/script use.

`runInkChat()` builds a `CliChatSession`, registers it with the in-process `SessionGateway`, and renders `<ChatApp>` which handles streaming, todos panel, approval modal, and slash commands.

## 16. Bare Invocation

`vole` with no subcommand defaults to interactive chat, but only when `process.stdin.isTTY === true`. Non-TTY contexts (piped stdin, CI, scripts) fall through to commander, which prints help. This avoids accidentally starting a chat process when `vole` is invoked from a test harness or pipeline.

The `runCli` library function (used by tests) short-circuits bare invocation to `runInteractiveConfiguredChat` so the readline-based test path still gets the same logical behavior without Ink.

## 17. Cancellation

The CLI should eventually support canceling an active run.

MVP cancellation can be best-effort:

- Stop future model or tool steps when possible.
- Mark the run as canceled in trace.
- Keep session history consistent.

The run queue owns run state. The CLI only sends a cancellation request.

## 18. Relationship to Agent Core

The CLI sends user input and local decisions into Agent Core.

The CLI receives:

- Assistant output events
- Trace events
- Approval requests
- Completion state
- Error state

The CLI must not call tools directly on behalf of the model.

## 19. Relationship to Web UI

The CLI is the first adapter. It should prove the adapter boundary.

Everything the Web UI needs later should already have a non-visual equivalent:

- User message submission
- Trace event rendering
- Permission approval
- Session selection
- Configuration display
- Run cancellation

If a behavior cannot be expressed without terminal assumptions, it likely belongs in the adapter layer.

## 20. Testing Requirements

CLI adapter tests should focus on user-visible workflows and boundaries.

Required test areas:

- Command parsing
- `chat` startup flow
- Session listing and resume behavior
- Slash command handling
- Permission prompt rendering and decision forwarding
- Trace rendering from structured events
- Error rendering
- Configuration loading through shared APIs
- Ensuring CLI does not import provider SDKs directly
- Ensuring CLI does not assemble prompts directly
- Ensuring CLI does not execute tools directly for model-requested actions

Any iteration that changes Agent Core events, permission prompts, trace events, session handling, or context reports should update CLI adapter tests.

## 21. Acceptance Criteria

The MVP CLI adapter is successful when:

- `vole chat` starts a usable interactive session.
- User messages reach Agent Core through a stable adapter API.
- Assistant responses render clearly.
- Trace events are visible and learning-friendly.
- Permission prompts work without moving policy into the CLI.
- The CLI does not own prompt assembly, tool selection, provider logic, permission policy, or session persistence rules.
- CLI behavior is covered by focused tests.

## 22. Related Documents

- [Main design](../product/vole-design.md)
- [Roadmap](../roadmap/overview.md)
- [Project Structure](./project-structure.md)
- [Configuration System](./configuration-system.md)
- [Agent Loop](./agent-loop.md)
- [Execution Trace](./execution-trace.md)
- [Permission System](./permission-system.md)
- [Run Queue](./run-queue.md)
- [Session Storage](./session-storage.md)

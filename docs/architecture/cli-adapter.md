# CLI Adapter

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [cli-adapter.zh-CN.md](./cli-adapter.zh-CN.md)

## 1. Purpose

The CLI adapter is the first user-facing product surface for ArvinClaw.

It lets the user start conversations, send goals, approve actions, inspect traces, resume sessions, and learn how the agent works from a terminal.

The key boundary:

The CLI owns interaction. Agent Core owns behavior.

## 2. Why This Module Exists

ArvinClaw starts with CLI because it is the smallest useful product surface and the easiest place to study agent internals.

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

## 4. MVP Commands

Initial commands:

| Command | Purpose | Phase |
| --- | --- | --- |
| `arvinclaw chat` | Start an interactive chat session | Phase 1 |
| `arvinclaw --version` | Show version | Phase 0-1 |
| `arvinclaw --help` | Show available commands | Phase 0-1 |

Early follow-up commands:

| Command | Purpose | Phase |
| --- | --- | --- |
| `arvinclaw run "<goal>"` | Run a one-off goal and exit | Phase 2-4 |
| `arvinclaw sessions` | List local sessions | Phase 5 |
| `arvinclaw resume <session>` | Resume a session | Phase 5 |
| `arvinclaw trace <session>` | Inspect stored trace events | Phase 5 |
| `arvinclaw skills` | List loaded skills | Phase 3 |
| `arvinclaw config` | Inspect effective configuration | Phase 1-2 |

MVP should avoid a large command surface. Commands should appear when the underlying module exists and has tests.

## 5. Interactive Chat

`arvinclaw chat` is the primary MVP workflow.

Expected behavior:

1. Load configuration.
2. Create or resume a lightweight session.
3. Create a run ID for each user turn.
4. Send the user message to Agent Core.
5. Stream or print assistant output.
6. Render trace events as they arrive.
7. Ask for permission when the core reports an approval request.
8. Persist session and trace data when storage exists.

The CLI should not know how the prompt was assembled. It can display a summary or report produced by the context package.

## 6. Slash Commands

Inside interactive chat, slash commands provide local control without sending every instruction to the model.

MVP slash commands:

| Slash Command | Purpose |
| --- | --- |
| `/help` | Show chat controls |
| `/exit` | End the session |
| `/trace` | Show recent explainable trace events |
| `/clear` | Clear terminal display, not session history |

Future slash commands:

| Slash Command | Purpose |
| --- | --- |
| `/skills` | Show loaded skills |
| `/context` | Show context assembly summary |
| `/config` | Show redacted effective configuration |
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

Later, `arvinclaw trace <session>` can inspect stored traces after a session ends.

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

The CLI may show effective non-secret configuration through `arvinclaw config`.

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

## 15. Cancellation

The CLI should eventually support canceling an active run.

MVP cancellation can be best-effort:

- Stop future model or tool steps when possible.
- Mark the run as canceled in trace.
- Keep session history consistent.

The run queue owns run state. The CLI only sends a cancellation request.

## 16. Relationship to Agent Core

The CLI sends user input and local decisions into Agent Core.

The CLI receives:

- Assistant output events
- Trace events
- Approval requests
- Completion state
- Error state

The CLI must not call tools directly on behalf of the model.

## 17. Relationship to Web UI

The CLI is the first adapter. It should prove the adapter boundary.

Everything the Web UI needs later should already have a non-visual equivalent:

- User message submission
- Trace event rendering
- Permission approval
- Session selection
- Configuration display
- Run cancellation

If a behavior cannot be expressed without terminal assumptions, it likely belongs in the adapter layer.

## 18. Testing Requirements

CLI adapter tests should focus on user-visible workflows and boundaries.

Required test areas:

- Command parsing
- `chat` startup flow
- Slash command handling
- Permission prompt rendering and decision forwarding
- Trace rendering from structured events
- Error rendering
- Configuration loading through shared APIs
- Ensuring CLI does not import provider SDKs directly
- Ensuring CLI does not assemble prompts directly
- Ensuring CLI does not execute tools directly for model-requested actions

Any iteration that changes Agent Core events, permission prompts, trace events, session handling, or context reports should update CLI adapter tests.

## 19. Acceptance Criteria

The MVP CLI adapter is successful when:

- `arvinclaw chat` starts a usable interactive session.
- User messages reach Agent Core through a stable adapter API.
- Assistant responses render clearly.
- Trace events are visible and learning-friendly.
- Permission prompts work without moving policy into the CLI.
- The CLI does not own prompt assembly, tool selection, provider logic, permission policy, or session persistence rules.
- CLI behavior is covered by focused tests.

## 20. Related Documents

- [Main design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Project Structure](./project-structure.md)
- [Configuration System](./configuration-system.md)
- [Agent Loop](./agent-loop.md)
- [Execution Trace](./execution-trace.md)
- [Permission System](./permission-system.md)
- [Run Queue](./run-queue.md)
- [Session Storage](./session-storage.md)

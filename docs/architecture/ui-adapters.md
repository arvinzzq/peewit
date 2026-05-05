# UI Adapters

Status: Draft
Date: 2026-05-05

Simplified Chinese version: [ui-adapters.zh-CN.md](./ui-adapters.zh-CN.md)

## 1. Purpose

A UI adapter translates between a user-facing surface and Agent Core.

ArvinClaw has one agent runtime (`AgentRuntime`) and multiple surfaces: terminal, browser, eventually desktop and messaging. The adapter layer keeps those surfaces interchangeable without duplicating agent logic.

The core rule:

Agent Core owns behavior. Adapters own interaction.

## 2. Why This Layer Exists

Without an explicit adapter boundary, each surface tends to grow its own version of:

- Prompt assembly
- Tool registration
- Permission policy
- Session persistence
- Message history loading

The result is two separate agents that drift apart over time. The adapter pattern prevents this by forcing all behavior through one core.

## 3. What Adapters Own

An adapter is responsible for:

- Collecting user input (terminal readline, HTTP POST, WebSocket message, etc.)
- Rendering agent output (stdout, SSE stream, WebSocket push, etc.)
- Rendering trace events (inline trace, structured log, trace panel)
- Presenting permission approval prompts (readline confirm, modal overlay, push notification)
- Forwarding approval decisions back to core via `ApprovalResolver`
- Managing the surface-specific lifecycle (process lifetime, HTTP connection, desktop window)

An adapter must not own:

- Prompt or context assembly
- Tool definitions or tool execution logic
- Permission policy decisions
- Session or message persistence rules
- Model provider configuration

## 4. What Core Provides to Adapters

`AgentRuntime` is the single interface between adapters and the agent:

```ts
for await (const event of runtime.runTurn({ sessionId, recentMessages, message })) {
  // adapter renders each event
}
```

Core emits a typed stream of `RuntimeEvent` values. Adapters consume the stream and render it to their surface.

The event types adapters care about:

| Event | What adapters do |
| --- | --- |
| `run_started` | Show thinking indicator |
| `token_delta` | Append text to current streaming message |
| `tool_started` | Show tool name and spinner |
| `tool_completed` | Hide spinner, show result summary |
| `tool_failed` | Show error summary |
| `approval_requested` | Show approval prompt, suspend display |
| `approval_resolved` | Hide prompt, resume display |
| `todos_updated` | Update task progress panel |
| `planning_stall_detected` | Show stall warning |
| `assistant_message_created` | Show final message text |
| `run_completed` | End the turn, show usage |
| `run_failed` | Show error, allow retry |

## 5. ApprovalResolver: The Adapter-to-Core Interface

When a tool action requires user approval, core calls `ApprovalResolver.resolve()` and suspends until a decision arrives. This is the one point where adapters must communicate back to core during a run.

```ts
export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<ApprovalDecision>;
}
```

Each adapter implements this differently:

- **CLI adapter (readline)**: writes the prompt to stdout, waits for readline input.
- **CLI adapter (Ink)**: renders an `<ApprovalPrompt>` component, waits for key press.
- **Web adapter**: sends `approval_requested` SSE event to the browser, suspends on a pending Promise, resolves when the browser POSTs an approval decision.
- **Background adapter**: follows configured auto-approve or auto-deny rules.

The `ApprovalResolver` is injected into `AgentRuntime` at construction time. Core does not know which surface is resolving.

## 6. Session and Trace Adapters

Session and trace stores are injected, not hard-coded:

- CLI: `JsonlSessionStore` backed by `~/.arvinclaw/sessions`.
- Web: initially `InMemorySessionStore`; can be upgraded to `JsonlSessionStore` or a database.
- Tests: `InMemorySessionStore` with controllable session IDs.

The `SessionStore` and `RuntimeTraceStore` interfaces are defined in `@arvinclaw/sessions` and `@arvinclaw/core`. Adapters choose an implementation at startup.

## 7. Streaming Through Adapters

When the provider implements `StreamingModelProvider`, runtime emits `token_delta` events. Adapters handle them differently:

- **CLI (Ink)**: feeds deltas into `<StreamingText>` component, which re-renders the current message in place.
- **Web**: writes each `token_delta` event as an SSE `data:` line to the open event stream.
- **Non-streaming CLI (tests)**: collects all events, renders the final `assistant_message_created` message.

Adapters that do not support streaming can ignore `token_delta` and wait for `assistant_message_created`, which always fires with the full content.

## 8. CLI Adapter

The CLI adapter lives in `apps/cli`.

Rendering path (Phase 6+):

```text
main()
  └─ Ink App component
       ├─ reads events from CliChatSession.sendMessage()
       ├─ renders streaming text via <StreamingText>
       ├─ shows tool progress via <ToolProgress>
       ├─ shows approval prompt via <ApprovalPrompt>
       └─ shows todos via <TodosPanel>
```

Test boundary:

```text
CliChatSession.sendMessage()
  └─ returns CliChatTurnResult { assistantText, approvalLines, todosLines, events }
```

The `CliChatSession` layer is injectable and does not import Ink. Tests exercise it directly.

## 9. Web Adapter

The Web adapter lives in `apps/web`.

```text
HTTP client (browser)
  └─ POST /api/sessions/:id/turns
       └─ Hono handler
            ├─ creates SSE response stream
            ├─ runs AgentRuntime.runTurn()
            ├─ writes each RuntimeEvent as SSE data line
            └─ holds connection open during approval_requested
```

Approval:

```text
browser receives approval_requested SSE event
  └─ renders <ApprovalModal>
       └─ POST /api/sessions/:id/approvals
            └─ server resolves approval Promise
                 └─ turn resumes, SSE continues
```

## 10. Adapter Comparison

| Concern | CLI (Ink) | Web (Hono + React) |
| --- | --- | --- |
| User input | Terminal readline / key events | HTTP POST body |
| Streaming output | Ink `<StreamingText>` re-render | SSE `data:` events |
| Approval prompt | `<ApprovalPrompt>` component | `<ApprovalModal>` + POST |
| Session store | `JsonlSessionStore` | `InMemorySessionStore` |
| Tool progress | `<ToolProgress>` spinner | SSE event → React state |
| Todos display | `<TodosPanel>` component | SSE event → React state |
| Process lifetime | Node.js process | Hono server process |

## 11. Future Adapters

The same pattern supports:

- **Desktop app**: Electron or Tauri adapter; native file dialogs for approval.
- **Messaging adapter**: Slack or Telegram bot; approval via reply buttons.
- **Background adapter**: No UI; auto-approve/deny per configured policy; structured log output.
- **CI adapter**: One-turn `run` command; no interactive approval; non-zero exit on denied.

Each new adapter only needs to implement `ApprovalResolver`, choose a `SessionStore`, and consume the `RuntimeEvent` stream. No changes to Agent Core.

## 12. Acceptance Criteria

- CLI and Web UI share the same `AgentRuntime`, `SessionStore`, and event types.
- No agent logic (context assembly, tool execution, permission policy) lives in an adapter.
- Adding a new adapter requires changes only in `apps/` and application wiring, not in packages.
- Approval resolver is the only path through which an adapter communicates back to core during a run.

## 13. Related Documents

- [Agent Loop](./agent-loop.md)
- [CLI Adapter](./cli-adapter.md)
- [Trace Visualization](./trace-visualization.md)
- [Permission System](./permission-system.md)
- [Session Storage](./session-storage.md)
- [Phase 6 Plan](../plans/phase-6-streaming-and-web-ui.md)

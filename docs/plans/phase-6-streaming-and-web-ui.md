# Phase 6 Streaming and Web UI Plan

Status: Complete
Date: 2026-05-05

Simplified Chinese version: [phase-6-streaming-and-web-ui.zh-CN.md](./phase-6-streaming-and-web-ui.zh-CN.md)

## Progress

Status: Complete

Completed commits:

- [x] Part A: Streaming ModelProvider — `StreamEvent`, `StreamingModelProvider`, OpenAI SSE streaming, Anthropic streaming, `FakeStreamingProvider`: `d53420d`
- [x] Part B: Runtime streaming events — `token_delta` event, `preferStreaming` opt-in, AgentRuntime streaming path: `451cb99`
- [x] Part C: Ink CLI upgrade — `app.tsx` with Ink components (streaming text, spinner, approval prompt, todos), `onEvent` callback on `sendMessage()`, dynamic import in `main()`: `a8ad560`
- [x] Part D: Web UI — `apps/web` Hono server with SSE turn streaming, React frontend with streaming display and approval modal: `85479a2`

## 1. Purpose

Phase 6 makes the agent responsive and multi-surface.

The two visible goals:
- Responses stream token by token instead of appearing all at once.
- The agent is accessible from a browser as well as a terminal.

The architectural goal:
- Prove that CLI and Web UI are two adapters over the same Agent Core, not two separate implementations.

## 2. Scope

This phase includes:

- Streaming variant of `ModelProvider` interface.
- Streaming implementation in `OpenAICompatibleProvider` and `AnthropicProvider`.
- `token_delta` runtime event so adapters can display incremental output.
- CLI rendering upgrade from plain stdout to Ink (React-based terminal UI).
- New `apps/web` package: Hono API server and React frontend.
- SSE-based streaming from server to browser.
- Basic chat UI with streaming, tool progress, and approval prompts.

This phase does not include:

- Context compaction.
- Multi-agent spawning.
- Desktop app.
- Auth/multi-user.
- Trace visualization panels (beyond basic event list in Web UI).
- Plugin marketplace.

## 3. Part A: Streaming ModelProvider

### Goal

Let providers emit token deltas as they arrive rather than waiting for a complete response.

### Interface additions in `packages/models/src/index.ts`

```ts
export type StreamEvent =
  | { type: "token_delta"; delta: string }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage }
  | { type: "message_done"; content: string; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean };

export interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>;
}

export function isStreamingProvider(provider: ModelProvider): provider is StreamingModelProvider {
  return "generateStream" in provider && typeof (provider as { generateStream: unknown }).generateStream === "function";
}
```

### Provider implementations

`OpenAICompatibleProvider.generateStream()`:
- Uses `stream: true` in the request body.
- Reads SSE chunks via `response.body` and parses `data:` lines.
- Emits `token_delta` for each text chunk in a `delta.content` field.
- Accumulates tool call chunks; emits `tool_calls` on finish.
- Emits `message_done` with final content and usage.

`AnthropicProvider.generateStream()`:
- Uses Anthropic SDK streaming (`stream: true` or `messages.stream()`).
- Translates `content_block_delta` events to `token_delta`.
- Translates `message_delta` stop events to `message_done` or `tool_calls`.

`FakeStreamingProvider`:
- Implements both `ModelProvider` and `StreamingModelProvider`.
- Accepts queued token strings and emits them with configurable delay.
- Useful for CLI and Web UI integration tests.

### Testing

- Unit tests: each provider streaming path with fake HTTP responses / injectable client.
- Verify `token_delta` events arrive before `message_done`.
- Verify `tool_calls` event shape matches non-streaming format.
- Verify `error` events for HTTP failures and parse failures.

## 4. Part B: Runtime Streaming Events

### Goal

Let AgentRuntime relay streaming token deltas as first-class runtime events so adapters can display incremental output without knowing which provider is in use.

### New runtime event type

```ts
export interface TokenDeltaEvent extends RuntimeEventBase {
  type: "token_delta";
  delta: string;
}
```

`token_delta` is added to `runtimeEventTypes` in `packages/core/src/index.ts`.

### AgentRuntime streaming path

When the runtime detects that the configured provider implements `StreamingModelProvider`:

1. Call `provider.generateStream(input)` instead of `provider.generate(input)`.
2. Yield `token_delta` events for each incoming `StreamEvent` of type `token_delta`.
3. Accumulate text content until `message_done` arrives.
4. Treat `tool_calls` and `error` events exactly as the non-streaming path.
5. Never emit `model_request_completed` until `message_done` or `tool_calls` arrives.

When the provider does not implement `StreamingModelProvider`, the runtime falls back to `generate()` as before.

### Design constraint

Agent Core does not change its decision logic. The `token_delta` path is a delivery detail — no tool calls are dispatched until the model signals completion.

### Testing

- Test `token_delta` events emitted in order.
- Test that non-streaming provider path is unchanged.
- Test that tool calls and errors work correctly through streaming path.
- FakeStreamingProvider should be usable in core tests.

## 5. Part C: Ink CLI Upgrade

### Goal

Replace the current plain-stdout CLI with an Ink-based rendering layer that supports live streaming output, tool progress indicators, and richer approval prompts.

### Why Ink

The current CLI uses `process.stdout.write` with newlines. This works for non-streaming line-by-line output but cannot:

- Update the same terminal region as tokens arrive.
- Show a spinner or progress indicator during tool execution.
- Render an approval block with risk details and an inline prompt.
- Re-render todos progress in place.

Ink (React for terminals) allows all of these by re-rendering components in place, exactly as OpenClaw does.

### Architecture

The test boundary (`runCli()`, `CliChatSession`) remains. Ink is added as the real-terminal rendering path:

```
main() — uses Ink App component
  └─ ChatApp — Ink root component
       ├─ ChatHistory — past turns
       ├─ CurrentTurn — streaming current turn
       │    ├─ StreamingText — live token delta display
       │    └─ ToolProgress — spinner during tool execution
       ├─ ApprovalPrompt — shown when runtime emits approval_requested
       └─ StatusLine — model, mode, session
```

`CliChatSession` stays as the non-rendering state manager. Ink components call `session.sendMessage()` and consume the event stream reactively.

### Key Ink components

`StreamingText`: Accepts an async iterable of `token_delta` events and renders text character by character as tokens arrive. Shows a cursor while incomplete.

`ToolProgress`: Shown between `tool_started` and `tool_completed` events. Displays tool name and elapsed time with a spinner.

`ApprovalPrompt`: Replaces the readline prompt. Renders tool name, risk level, reason, and three options (y/n/details) as an interactive block. Handles keyboard input via Ink's `useInput` hook.

`TodosPanel`: Updates in place when `todos_updated` fires. Uses status icons for pending/in_progress/completed.

### Testability

- `runCli()` and `CliChatSession` remain injectable and do not import Ink.
- `main()` in the CLI entry point uses Ink components.
- Ink's own `@ink-testing-library/react` can test Ink components in isolation.
- Integration tests continue to use `CliChatSession.sendMessage()` directly.

### Dependencies

- `ink` — React-based terminal renderer
- `react` — required by Ink
- `@types/react` — TypeScript support

### Testing

- Unit tests for each Ink component using `@ink-testing-library/react`.
- Verify streaming text renders incrementally.
- Verify approval prompt accepts `y`/`n`/`d` keys.
- Verify todos panel updates on todos_updated events.
- Existing integration tests via `CliChatSession` remain unchanged.

## 6. Part D: Web UI

### Goal

A browser-based interface where the user can chat, see streaming responses, approve tool actions, and inspect recent trace events — using the same Agent Core as the CLI.

### Stack

- **Backend**: Hono — lightweight TypeScript-native HTTP framework, runs on Node.js, minimal boilerplate.
- **Frontend**: React + Vite — fast HMR, familiar stack.
- **Streaming**: Server-Sent Events (SSE) — simpler than WebSocket for server-to-client unidirectional streaming; works everywhere without custom protocol.
- **Port**: `3120` default.

### New app: `apps/web`

```
apps/web/
  src/
    server.ts       — Hono app: API routes, SSE streaming, static file serving
    client/
      main.tsx      — React entry point
      App.tsx        — root component
      components/
        ChatView.tsx
        MessageList.tsx
        StreamingMessage.tsx
        ApprovalModal.tsx
        TracePanel.tsx
  public/
    index.html
  package.json
  tsconfig.json
  vite.config.ts
```

### API surface

```
POST   /api/sessions                     Create session → { sessionId }
GET    /api/sessions                     List sessions → { sessions[] }
GET    /api/sessions/:id/messages        Get messages → { messages[] }
GET    /api/sessions/:id/events          SSE stream of runtime events for a session turn
POST   /api/sessions/:id/turns           Start a new turn → 200, turn is streamed via SSE
POST   /api/sessions/:id/approvals       Resolve an approval request → { approved, reason }
```

### SSE streaming

When the frontend calls `POST /api/sessions/:id/turns`, the server:

1. Creates an SSE response (`Content-Type: text/event-stream`).
2. Starts `runtime.runTurn()` for the message.
3. Streams each `RuntimeEvent` as an SSE event.
4. Closes the SSE stream when `run_completed` or `run_failed` fires.

The frontend reads events via `EventSource` and updates React state incrementally.

### Approval flow in Web UI

When the server encounters `approval_requested`:

1. Suspends the turn and holds the SSE connection open.
2. Sends an `approval_requested` SSE event to the client.
3. Renders `<ApprovalModal>` with tool name, risk, and reason.
4. User clicks Approve/Deny.
5. Frontend posts to `POST /api/sessions/:id/approvals`.
6. Server resolves the approval; turn continues.
7. SSE stream resumes.

The `ApprovalResolver` for the Web server uses a pending Promise that is resolved when the approval POST arrives.

### React frontend

MVP UI components:
- `ChatView` — main layout with message list and input box.
- `MessageList` — renders past messages and current streaming message.
- `StreamingMessage` — shows accumulating text with a cursor.
- `ApprovalModal` — overlay shown during approval requests.
- `TracePanel` — collapsible list of recent trace events.

No auth, no multi-user, no persistent sessions across server restarts (Phase 6 uses `InMemorySessionStore` on server; durable storage in Phase 7+).

### Testing

- Hono API route tests using Hono's test utilities.
- SSE event shape tests.
- Approval resolver promise flow tests.
- React component tests with `@testing-library/react`.
- E2E smoke test: send message, verify response appears.

## 7. Commit Sequence

Each commit must include code + docs + header updates together.

1. `feat(models): add streaming interface and provider implementations`
   - `StreamEvent`, `StreamingModelProvider`, `isStreamingProvider` in models
   - `generateStream()` in `OpenAICompatibleProvider` and `AnthropicProvider`
   - `FakeStreamingProvider`
   - Tests
   - Update `packages/models/README.md`, `AGENTS.md`, source header

2. `feat(core): add token_delta runtime event and streaming path`
   - `token_delta` event type
   - Streaming detection and relay in `AgentRuntime`
   - Tests
   - Update `packages/core/README.md`, `AGENTS.md`, source header

3. `feat(cli): upgrade to Ink rendering`
   - Add Ink dependency
   - Ink components: `StreamingText`, `ToolProgress`, `ApprovalPrompt`, `TodosPanel`, `StatusLine`
   - Ink `App` root component and updated `main()`
   - `CliChatSession` unchanged; Ink layer on top
   - Tests
   - Update `apps/cli/README.md`, `AGENTS.md`, source header

4. `feat(web): add web app with Hono server and React frontend`
   - `apps/web` package scaffold
   - Hono server with API routes and SSE
   - React + Vite frontend
   - `ApprovalResolver` for HTTP approval flow
   - Tests
   - Update root `README.md`, `docs/roadmap/overview.md`
   - New `packages/web/README.md`, `AGENTS.md`

## 8. Non-Goals

- Context compaction or token budget management.
- Multi-agent spawning.
- Desktop app packaging.
- Authentication or multi-user sessions.
- Trace visualization panels beyond a basic event list.
- OpenClaw `sessions_spawn` equivalent.
- Context length exceeded handling.

## 9. Acceptance Criteria

- Model responses stream token by token in the CLI terminal via Ink.
- CLI uses Ink components for streaming output, tool progress, and approval prompts.
- `runCli()` and `CliChatSession` tests remain green without Ink in test paths.
- Web UI at `http://localhost:3120` can chat with a real or fake provider.
- Web UI displays streaming tokens as they arrive.
- Web UI shows approval prompt when tool action requires approval.
- Web UI and CLI both use the same `AgentRuntime`, `SessionStore`, and event types.
- `pnpm run check` passes for all packages.

## 10. Related Documents

- [Roadmap](../roadmap/overview.md)
- [UI Adapters](../architecture/ui-adapters.md)
- [Trace Visualization](../architecture/trace-visualization.md)
- [Model Provider](../architecture/model-provider.md)
- [CLI Adapter](../architecture/cli-adapter.md)
- [Agent Loop](../architecture/agent-loop.md)

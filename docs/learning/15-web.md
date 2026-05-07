# Module 15: apps/web

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `15-web.zh-CN.md`

Related source: `apps/web/src/server.ts`, `apps/web/src/client/App.tsx`

## 0. How to Use This Document

This document is part of Stage 5 (System Synthesis) in the [learning guide](./guide.md).
Read it after [14-cli.md](./14-cli.md) — the two adapters solve the same problem with
different transport layers. The contrasts between them are the main learning value here.

**Before reading**: Read `server.ts` in full (481 lines). Pay special attention to
`WebApprovalResolver` — it is the most interesting part. Then skim `App.tsx` to understand
the client side. Notice what `createWebSession` has in common with CLI's `createConfigured`,
and what it omits.

**Focus questions**:
- `WebApprovalResolver` has `resolve()` and `settle()`. How do two separate HTTP requests
  coordinate to fulfil a single Promise?
- The server has two storage tiers: `sessions` Map and `sharedStore`. What does each hold,
  and what happens to each when the process restarts?
- The SSE turn handler only persists `user` and `assistant` messages, not tool calls.
  How is this different from the CLI, and what does the browser lose as a result?
- The WebSocket handler does the same turn logic as the SSE handler. Why does the server
  need both?

**Checkpoint**: You understand this module when you can describe the complete path from the
browser sending a message to the streaming text appearing character-by-character, including
all network hops and which package handles each step.

## 1. What This Module Does

**Plain language**: The web adapter is a bilingual translator. The agent speaks in runtime
events; the browser speaks in HTTP/JSON and SSE text streams. The web adapter translates
between them — it receives HTTP POST requests, calls `AgentRuntime.runTurn`, and streams
the resulting events back to the browser in real time. The browser's React app reads those
events and updates the UI without waiting for the full response.

**Technical summary**: `apps/web` is the browser adapter. The server (`server.ts`) is a
Hono HTTP application that exposes a REST+SSE API over sessions, turns, and approvals, plus
a WebSocket endpoint for bidirectional communication. `WebApprovalResolver` uses Promises to
bridge the synchronous approval request from the agent runtime to an asynchronous HTTP POST
from the browser. The client (`App.tsx`) is a React application that creates sessions,
streams turn events via SSE, and renders approval prompts inline.

## 2. Architecture: Two Storage Tiers

The web server maintains two distinct storage layers:

```
sessions Map (module-level)       sharedStore (JsonlSessionStore)
────────────────────────────      ─────────────────────────────────
Per-process, in-memory            Durable, disk-backed JSONL files
Created by POST /api/sessions     Shared across all sessions
Holds: AgentRuntime,              Holds: session metadata,
       WebApprovalResolver,              message history,
       InMemoryRuntimeTraceStore         trace events
Lost on process restart           Survives process restart
```

This is the key difference from the CLI. The CLI's `CliChatSession` fuses both tiers into
one object. The web server splits them: durable data goes to `sharedStore`; transient runtime
state goes to `sessions`. When the process restarts, `sharedStore` survives but `sessions`
is empty — the next turn for an existing session calls `createWebSession(config, id)` to
rebuild the transient state from scratch.

## 3. WebApprovalResolver: Promise Bridge

```ts
class WebApprovalResolver implements ApprovalResolver {
  readonly #pending = new Map<string, { request, resolve }>();

  resolve(request: ApprovalRequest): Promise<ApprovalResolution> {
    return new Promise<ApprovalResolution>((resolve) => {
      this.#pending.set(request.call.id, { request, resolve });
      // Promise hangs here — agent runtime is suspended waiting
    });
  }

  settle(callId: string, decision: ApprovalResolution): boolean {
    const entry = this.#pending.get(callId);
    if (entry === undefined) return false;
    this.#pending.delete(callId);
    entry.resolve(decision);  // resumes the agent runtime
    return true;
  }
}
```

**How two HTTP requests coordinate one Promise**:

1. Browser sends `POST /api/sessions/:id/turns` → SSE stream opens
2. Agent runtime calls a medium-risk tool → calls `resolver.resolve(request)` → Promise hangs
3. SSE stream emits `approval_requested` event to browser
4. Browser renders approval UI, user clicks approve/deny
5. Browser sends `POST /api/sessions/:id/approvals` with `{ callId, approved }`
6. Server calls `resolver.settle(callId, decision)` → Promise resolves
7. Agent runtime resumes, tool executes or is denied
8. SSE stream continues with subsequent events

The SSE stream (step 1) remains open for the entire turn. The approval REST call (step 5) is
a separate HTTP request that resolves the suspended Promise. The two requests are connected
only through the `WebApprovalResolver` map, keyed by `callId`.

## 4. API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sessions` | Create new session or resume existing (body: `{ sessionId? }`) |
| `GET` | `/api/sessions` | List all sessions from durable store |
| `GET` | `/api/sessions/:id` | Single session metadata |
| `GET` | `/api/sessions/:id/messages` | Message history |
| `POST` | `/api/sessions/:id/turns` | Run a turn — response is SSE stream of runtime events |
| `POST` | `/api/sessions/:id/approvals` | Settle a pending approval |
| `GET` | `/api/gateway/sessions` | List active sessions from gateway |
| `GET /ws/:id` | WebSocket | Bidirectional: send turns + approvals, receive events |

## 5. SSE Turn Handler

```ts
app.post("/api/sessions/:id/turns", async (c) => {
  // ... ensure runtime is initialized for this session
  const recentMessages = await store.listMessages(id, { limit: 12 });

  return streamSSE(c, async (stream) => {
    for await (const event of session.runtime.runTurn({ ... })) {
      await session.traceStore.append(event);
      await store.appendTraceEvent({ sessionId: id, event });
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      if (event.type === "run_completed" || event.type === "run_failed") break;
    }

    // Persist only user + assistant messages after turn completes
    await store.appendMessage({ sessionId: id, role: "user", content: message });
    if (assistantText !== "") {
      await store.appendMessage({ sessionId: id, role: "assistant", content: assistantText });
    }
    webGateway.touch(id);
  });
});
```

**What the web adapter omits vs. CLI**:

The CLI's `sendMessage` persists all messages from `turn_complete` — user, tool calls, tool
results, and assistant. The web SSE handler persists only the user message and final assistant
text. Tool calls and tool results are sent to the browser as SSE events but not stored in the
JSONL file.

This means the browser can display a full trace during the session, but message history
loaded on resume (`GET /api/sessions/:id/messages`) shows only user/assistant pairs, not
intermediate tool steps.

## 6. WebSocket Alternative

The WebSocket endpoint (`/ws/:id`) provides bidirectional communication:
- Client sends `{ type: "turn", message }` → server runs the turn, sends events as JSON frames
- Client sends `{ type: "approval", callId, approved, reason }` → server settles the approval
- Server sends runtime events as JSON frames, one per event

WebSocket and SSE cover the same use case with different trade-offs:

| | SSE | WebSocket |
|---|---|---|
| Direction | Server → Client only | Bidirectional |
| Approval flow | Separate REST POST | Inline WS message |
| Protocol | HTTP/1.1 + chunked | Upgraded TCP |
| Reconnection | Auto-reconnect via browser | Manual |

SSE is simpler for read-heavy use cases (watching a turn stream). WebSocket is better for
interactive use cases where the client needs to send data mid-stream (approvals, cancellation).

## 7. Client: React App (App.tsx)

The client is a two-view React SPA:

**`SessionsPage`**: lists sessions from `GET /api/sessions`, offers "New Session" and "Resume"
buttons. Creates sessions via `POST /api/sessions`.

**`ChatView`**: the main interface. On mount, fetches message history. On submit, sends
`POST /api/sessions/:id/turns` and processes the SSE stream:

```ts
const reader = response.body.getReader();
// ... read chunks, split on "\n\n" SSE boundary
// parse event: "event: <type>\ndata: <json>"
if (event.type === "token_delta")          setStreamingText(prev => prev + event.delta)
if (event.type === "tool_started")         setCurrentTool(event.toolName)
if (event.type === "approval_requested")   setPendingApproval({ callId, ... })
if (event.type === "assistant_message_created") add to messages
```

Approval is handled inline: when `approval_requested` arrives, the UI renders an approval
card. The user clicks approve/deny → `POST /api/sessions/:id/approvals` → the SSE stream
continues.

## 8. Differences from CLI

| Concern | CLI | Web |
|---|---|---|
| Approval | readline prompt, blocks | Promise bridge + REST settle |
| Persistence | All messages (user + tools + assistant) | User + assistant only |
| Compaction persistence | Yes (`appendCompactBoundary`) | No |
| Tool set | Full + memory + heartbeat | Smaller (no edit_file, search_files, heartbeat) |
| Streaming render | Buffered text output | Live `token_delta` → React state |
| Session factory | `createConfigured` / `createFake` | `createWebSession` (only real) |
| Testability | Full injection via `RunCliOptions` | Not currently injected |

The most significant omission in the web adapter is the lack of compaction boundary persistence.
If context compaction fires during a web turn, the `compact_boundary` record is not written
to the JSONL file — the next session load will replay the full uncompacted history.

## 9. Key Design Decisions

**Hono for HTTP, not Express**

Hono is a lightweight TypeScript-native framework with first-class SSE support (`streamSSE`)
and a clean middleware API. The `@hono/node-server` adapter bridges Hono's Web API-based
fetch handler to Node.js's HTTP server, enabling WebSocket upgrades on the same port.

**`WebApprovalResolver` as a per-session singleton**

One `WebApprovalResolver` per session (not one global). This isolates approval state —
two concurrent sessions cannot accidentally settle each other's approvals. The resolver is
created in `createWebSession` and lives in the `sessions` Map entry.

**Lazy runtime reconstruction on turn request**

If a session exists in the durable store but not in the `sessions` Map (process restarted),
the turn handler calls `createWebSession(config, id)` to rebuild the transient runtime.
This means the web server recovers silently from restarts — the client retries the turn and
the server reconstructs the runtime from config + session ID.

**`preferStreaming: true` always for web**

The web adapter always sets `preferStreaming: true` on `AgentRuntime`. This enables
`token_delta` events which power the character-by-character streaming UI. The CLI defaults
to `false` and enables it only for the Ink rendering path (not the plain text path).

## 10. Insights

**The approval mechanism is the hardest part of building a web agent adapter.** Interactive
approval in a terminal is synchronous: the agent suspends, the human types, the agent resumes.
In a browser, there is no synchronous channel. `WebApprovalResolver` solves this by suspending
the agent in a Promise and providing a REST endpoint to resolve it. The browser client polls
the SSE stream to detect the suspension and renders an approval UI. This is the canonical
pattern for "async human-in-the-loop" in web agents.

**SSE is simpler than WebSocket for streaming agent output.** The agent emits events; the
browser reads them. This is naturally unidirectional — SSE is the right protocol. WebSocket
adds complexity (upgrade handling, message framing, reconnection) without benefit unless the
client needs to send data mid-stream. Vole provides both so developers can choose based on
their use case.

**The web adapter is not fully symmetric with the CLI.** Missing: compaction boundary
persistence, tool call/result persistence, `update_heartbeat`, `edit_file`, `search_files`,
`append_daily_memory`. These omissions reflect the web adapter's simpler scope — a browser
chat UI, not a full agent workstation. A production web adapter would close these gaps.

## 11. Review Questions

1. The browser sends `POST /api/sessions/:id/turns`. The agent runtime calls a tool that
   requires approval. Trace the complete sequence until the tool executes.
   > (1) SSE stream opens. (2) Agent calls `approvalResolver.resolve(request)` — Promise hangs,
   > agent suspended. (3) Server emits `approval_requested` SSE event to browser. (4) Browser
   > renders approval UI. (5) User approves → browser sends `POST /api/sessions/:id/approvals`
   > with `{ callId, approved: true }`. (6) Server calls `resolver.settle(callId, decision)` →
   > Promise resolves. (7) Agent runtime receives approval and executes the tool. (8) SSE
   > stream continues with `tool_started`, `tool_completed`, etc.

2. The process restarts. A browser client resumes a session by sending a turn. What happens?
   > The turn handler checks `sessions.get(id)` — returns `undefined` (Map was lost on restart).
   > It calls `createWebSession(config, id)` with the existing session ID. `createWebSession`
   > calls `store.getSession(id)` — finds it in the durable JSONL store. It rebuilds a fresh
   > `AgentRuntime`, `WebApprovalResolver`, and `InMemoryRuntimeTraceStore`. The turn proceeds
   > with message history loaded from the JSONL store.

3. What is lost if context compaction fires during a web turn?
   > The web turn handler does not call `appendCompactBoundary`. The `compact_boundary` record
   > is not written to JSONL. On the next turn, the session store replays the full uncompacted
   > history — the compaction effect is lost, and the agent sees the full (potentially very
   > long) message history again. This is a gap vs. the CLI adapter.

4. Why does `WebApprovalResolver` use a `Map<string, ...>` keyed by `callId`?
   > Multiple tool calls in one turn can each require approval, potentially in parallel.
   > Keying by `callId` allows each tool call's approval Promise to be settled independently.
   > A single `{ resolve }` slot would not work if two tools both needed approval simultaneously.

5. What does the web adapter omit from the tool set compared to the CLI?
   > The web adapter does not include `edit_file`, `append_file`, `search_files`,
   > `update_heartbeat`, or `append_daily_memory`. It has a smaller default tool set — focused
   > on read/write/shell/web, without the advanced file editing and memory tools the CLI provides.
   > This reflects a simpler scope: a web chat UI, not a full development agent.

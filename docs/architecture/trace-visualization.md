# Trace Visualization

Status: Draft
Date: 2026-05-05

Simplified Chinese version: [trace-visualization.zh-CN.md](./trace-visualization.zh-CN.md)

## 1. Purpose

The trace is a structured record of what the agent did, why, and with what result.

Trace visualization turns that record into something a human can read — either live as a run unfolds or in retrospect after a session ends.

Two goals:
- **Learning**: let users understand how the agent made decisions, called tools, and composed its response.
- **Debugging**: let developers and users understand failures, unexpected tool calls, and approval decisions.

## 2. What Gets Traced

Every `RuntimeEvent` is a trace entry. The event types and their semantic meaning:

| Event | Meaning |
| --- | --- |
| `run_started` | A user message arrived; the agent began a turn |
| `context_assembled` | System prompt and message history were assembled |
| `model_request_started` | The agent sent a request to the model |
| `token_delta` | A single text token arrived from a streaming model |
| `model_request_completed` | The model returned a final response or tool call batch |
| `tool_call_requested` | The model requested a specific tool call |
| `tool_call_permission_evaluated` | The permission policy evaluated the tool call |
| `approval_requested` | The tool call needs user approval; run suspended |
| `approval_resolved` | The user approved or denied the tool call |
| `tool_started` | The tool started executing |
| `tool_completed` | The tool returned a result |
| `tool_failed` | The tool returned an error |
| `todos_updated` | The model updated its task list |
| `planning_stall_detected` | A plan-only turn was detected; retry injected |
| `assistant_message_created` | A final text message was produced |
| `run_completed` | The turn ended successfully |
| `run_failed` | The turn ended with an error |

`token_delta` events are high-frequency and display-only. They are not stored in trace history by default; only the final `assistant_message_created` is stored.

## 3. Trace Storage

Trace events are stored per session in the `SessionStore` via `appendTraceEvent()`.

Stored events can be replayed via `listTraceEvents()` after a session ends or between sessions.

The default trace store in tests is `InMemoryRuntimeTraceStore`. In production CLI, trace events are appended to the JSONL session file alongside messages.

`token_delta` events are intentionally not stored — they would dominate the trace file with no benefit. The accumulated text is available from `assistant_message_created`.

## 4. CLI Trace Rendering

### Compact mode (default, live)

During a run, the CLI renders a compact one-line trace in real time:

```
1. Received user message (run_started)
2. Assembled context (context_assembled)
3. Started model request (model_request_started)
   [streaming text appears here]
4. Completed model request (model_request_completed)
5. Requested tool call (tool_call_requested)
6. Evaluated tool permission (tool_call_permission_evaluated)
7. Approval required: write_file [risk: medium]
   Approve once? [y/N/details]
8. Resolved approval (approval_resolved)
9. Started tool (tool_started)
10. Completed tool (tool_completed)
11. Created assistant message (assistant_message_created)
12. Completed run (run_completed)
```

### `/trace` slash command

Shows the stored trace for the current session at any time:

```
Recent Trace:
1. Received user message (run_started)
...
```

### Verbose trace (debug verbosity)

When `trace.verbosity` is `debug`, includes tool input/output summaries and raw provider metadata.

### Ink-based live trace (Phase 6)

With Ink, the trace panel updates in place rather than appending lines. A collapsed trace summary becomes expandable.

## 5. Web UI Trace Rendering

In the Web UI, trace events arrive as SSE data lines. The React frontend updates a `<TracePanel>` component as each event arrives.

MVP Web trace panel:
- Collapsible list of events, grouped by tool call sequence.
- Tool calls show name and risk level.
- Approval events show decision.
- Final message shown in the main chat view.

Phase 7+ can add richer trace visualization: timing bars, token usage graphs, permission decision tree.

## 6. Streaming Token Display

`token_delta` events are display-only and not stored. They feed the live streaming text display in real time.

**CLI (Ink)**: `<StreamingText>` accumulates tokens and re-renders the text in place. A blinking cursor follows the last character. When `assistant_message_created` arrives, the streaming state is replaced with the final settled text.

**Web UI**: The SSE client appends each `token_delta.delta` to a local string buffer in React state. The `<StreamingMessage>` component re-renders on each delta. `assistant_message_created` replaces the buffer with the authoritative final content.

**Non-streaming CLI (tests)**: `token_delta` events are not emitted. `assistant_message_created` is the first and only message event.

## 7. Trace vs Session History

| Storage | Content | Purpose |
| --- | --- | --- |
| Session messages | `role: user/assistant` + `content` | Context window reconstruction |
| Trace events | Full `RuntimeEvent` stream | Learning, debugging, audit |

Session messages go into context assembly when a session is resumed. Trace events are for human inspection only and do not feed back into the model.

## 8. Approval Trace

Approval events are always trace-visible. The trace shows:

- Which tool call was requested.
- What the permission policy decided (risk, reason).
- Whether the user approved or denied.
- The approval reason.

This makes permission decisions auditable after the fact.

## 9. Error Rendering

`run_failed` includes a reason string. Adapters render it prominently:

- CLI: prints `Error: <reason>` in red (or a styled block in Ink).
- Web UI: shows an error banner in the chat view.

Tool failures (`tool_failed`) are less severe — the model can often recover by trying a different approach. Adapters show a compact warning rather than interrupting the run.

## 10. Acceptance Criteria

- Every run produces a complete trace stored in the session file.
- The CLI `/trace` command shows stored trace events for the current session.
- Live CLI trace renders in compact one-line format during a run.
- `token_delta` events are not stored in trace history.
- Web UI shows trace events in a collapsible panel.
- Approval decisions are always trace-visible.
- Trace can be replayed from session store after a session ends.

## 11. Related Documents

- [Execution Trace](./execution-trace.md)
- [UI Adapters](./ui-adapters.md)
- [CLI Adapter](./cli-adapter.md)
- [Agent Loop](./agent-loop.md)
- [Session Storage](./session-storage.md)
- [Phase 6 Plan](../plans/phase-6-streaming-and-web-ui.md)

# Execution Trace

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [execution-trace.zh-CN.md](./execution-trace.zh-CN.md)

## 1. Purpose

Execution trace is the visible record of what the agent did during a task.

Peewit should be useful as a product and as a learning project. The trace is the bridge between those goals: it lets users understand how the agent interpreted a goal, selected tools, handled permissions, observed results, and reached an answer.

The core rule:

Trace explains execution. It must not expose hidden model reasoning.

## 2. Why This Module Exists

Without trace, an agent feels like a black box. Users may see the final answer, but they cannot tell what happened, whether a tool was used safely, or why the agent stopped.

Execution trace gives Peewit:

- User trust
- Debuggability
- Learning visibility
- Permission audit history
- Tool execution history
- A foundation for future Web UI visualization

## 3. Trace Levels

Peewit should support multiple trace levels.

| Level | Use | Content |
| --- | --- | --- |
| Concise | Quick product use | Tool names, short results, final answer |
| Explainable | Default MVP mode | Goal interpretation, plan, tool choice reason, permission decision, input/output summary, next step |
| Debug | Development | Raw provider messages, raw tool arguments, timing, token usage when available |

MVP should default to Explainable.

Debug trace may include sensitive or noisy information, so it should not be the default user experience.

## 4. What Trace Should Show

The default explainable trace should show:

- The user goal received
- How the agent understood the goal
- Whether a plan was created or updated
- Which tool was selected
- Why the tool was selected
- What permission decision was made
- Whether user approval was requested
- A safe summary of tool input
- A safe summary of tool output
- What the agent will do next
- The final result
- Any error or cancellation

The trace should be detailed enough to learn from, but not so verbose that normal use becomes painful.

## 5. What Trace Must Not Show

Trace must not include:

- Hidden chain-of-thought
- Raw secrets
- Full contents of secret-like files
- Unredacted API keys
- Unbounded command output
- Large raw file contents unless explicitly requested and safe
- Sensitive provider metadata by default

Trace should summarize risky or large content and preserve references where possible.

## 6. Trace Events

The implementation plan should refine exact event types, but MVP trace events may include:

- `user_message_received`
- `context_built`
- `model_response_received`
- `plan_created`
- `plan_updated`
- `tool_selected`
- `tool_call_permission_evaluated`
- `approval_requested`
- `approval_resolved`
- `tool_started`
- `tool_completed`
- `tool_failed`
- `observation_recorded`
- `final_response`
- `task_cancelled`
- `task_failed`

Events should be structured data, not only formatted text. This allows the CLI, Web UI, and future logs to render the same trace differently.

## 7. Event Shape

A trace event should include:

- Event ID
- Timestamp
- Event type
- Short title
- Human-readable summary
- Optional structured details
- Related tool call ID, if any
- Related permission decision ID, if any
- Visibility level
- Redaction status when relevant

Illustrative shape:

```ts
interface TraceEvent {
  id: string;
  timestamp: string;
  type: TraceEventType;
  title: string;
  summary: string;
  details?: unknown;
  visibility: "concise" | "explainable" | "debug";
  redacted?: boolean;
}
```

## 8. Tool Trace

Tool-related trace should record:

- Tool name
- Tool purpose summary
- Safe input summary
- Permission decision
- Start time
- End time
- Success or failure
- Safe output summary
- Source path or URL when relevant

Tool trace should avoid dumping large raw outputs into the model context or CLI display. The trace store can keep structured metadata while the model receives a smaller observation.

## 9. Permission Trace

Permission trace should record:

- Action being evaluated
- Risk level
- Decision type: allow, ask, or deny
- Decision reason
- Whether user approval was requested
- Whether approval was granted or denied

Permission trace is important because it explains why the agent could or could not continue.

## 10. Error Trace

Failures should be traceable.

Error trace should include:

- What failed
- Where it failed
- Whether the failure was recoverable
- What the agent did next
- Whether the user needs to take action

Errors should be normalized enough that the user sees clear information instead of raw stack traces during normal use.

## 11. Trace Storage

MVP trace storage can be local and simple.

Trace records should eventually be associated with:

- Session ID
- Task ID
- User turn ID
- Tool call ID
- Timestamp

Phase 5 persists runtime trace events into the same JSONL file as the session messages. This keeps trace replay local, append-only, and easy to inspect while leaving room for a richer trace index later.

## 12. CLI Rendering

The CLI should render trace in a readable way.

MVP behavior:

- Show important trace events inline during `chat`.
- Provide `/trace` to show recent trace details.
- For named sessions, `/trace` should load the persisted current-session trace after the CLI process restarts.
- Hide debug-only details by default.
- Clearly mark permission prompts and tool results.

The CLI renderer should consume structured trace events instead of reconstructing behavior from raw logs.

## 13. Web UI Evolution

The Web UI can later use the same trace events to show:

- Timeline view
- Tool call panels
- Permission approval cards
- Plan progress
- Error details
- Source links

This is why trace events should be structured from the beginning.

## 14. Redaction

Trace needs redaction rules.

MVP should redact:

- API keys
- Environment secrets
- Secret-like file contents
- Large command outputs
- Known credential patterns

Redaction should happen before trace is displayed or persisted when practical.

## 15. Testing Requirements

Execution trace needs tests because it is the user's main window into agent behavior.

Required test areas:

- Trace event creation for model responses
- Trace event creation for tool calls
- Trace event creation for permission decisions
- Redaction of secrets and large outputs
- CLI rendering of explainable trace
- Debug details hidden by default
- Error trace behavior
- Session association when persistence is added
- Persistence and replay of current-session trace
- Regression tests for every new trace event type

Trace tests should be updated whenever Agent Loop, Tool System, Permission System, CLI rendering, or session persistence changes.

## 16. Acceptance Criteria

The MVP execution trace should be considered successful when:

- Every user turn produces trace events.
- Tool calls are visible in trace.
- Permission decisions are visible in trace.
- Errors are visible in trace.
- Secret-like content is redacted.
- CLI can show recent trace details.
- CLI can replay persisted trace details for a named session.
- Trace data is structured enough for future Web UI rendering.
- Trace behavior is covered by unit and integration tests.

## 17. Related Documents

- [Main design](../product/peewit-design.md)
- [Roadmap](../roadmap/overview.md)
- [Agent loop](./agent-loop.md)
- [Tool system](./tool-system.md)
- [Permission system](./permission-system.md)
- [Project structure](./project-structure.md)
- [CLI adapter](./cli-adapter.md)

# Run Queue

Status: Active
Date: 2026-05-11

Simplified Chinese version: [run-queue.zh-CN.md](./run-queue.zh-CN.md)

## 1. Purpose

The run queue controls how Vole accepts, orders, executes, and persists agent runs.

OpenClaw research shows that runs are serialized per session and coordinated through queues and session write locks. Vole should adopt this architecture in stages.

The core rule:

A session should not have multiple uncontrolled agent runs writing to the same history at the same time.

## 2. Why This Module Exists

Without run queue semantics, multiple user messages, background tasks, or future channel events can trigger overlapping agent runs.

That creates risks:

- Conversation history can be written out of order.
- Tool observations can attach to the wrong turn.
- Permission prompts can become confusing.
- Trace events can interleave incorrectly.
- Background automation can race with user-driven chat.

The run queue gives Vole predictable execution and persistence behavior.

## 3. MVP Scope

MVP does not need a complex distributed queue.

MVP should include:

- Explicit run IDs
- One active run per CLI session
- In-memory run state
- Safe cancellation path
- Ordered session writes
- Trace events tied to run ID

MVP can defer:

- Persistent queue
- Cross-process coordination
- Background run scheduling
- Multi-agent routing
- Remote node execution
- Run retry policy

## 4. Run Identity

Every agent run should have a run ID.

A run ID lets the system connect:

- User message
- Agent response
- Tool calls
- Permission decisions
- Trace events
- Session writes
- Errors or cancellation

The run ID should appear in trace metadata and session records.

## 5. Session Serialization

Vole should eventually serialize runs per session.

Rule:

Only one run should actively mutate a session at a time.

If a second run is requested for the same session, the system can:

- Reject it
- Queue it
- Ask the user whether to cancel the active run
- Treat it as a steering message in future phases

MVP can start by rejecting overlapping runs inside the same CLI process.

## 6. Global Queue

A future global queue can limit total concurrent work across sessions.

This matters when Vole supports:

- Multiple sessions
- Web UI
- Background automation
- Messaging channels
- Multi-agent routing

MVP can defer a global queue, but the run model should leave room for one.

## 7. Session Write Lock

Session write locks protect session history and trace persistence.

The lock should ensure:

- Messages are appended in order.
- Tool observations attach to the correct run.
- Trace events remain ordered for a session.
- Compaction or memory flush does not race with normal writes.

MVP can use simple single-process ordering. Later phases can implement explicit locks in the session storage layer.

## 8. Run States

Run state should be explicit.

Suggested states:

- `queued`
- `running`
- `waiting_for_approval`
- `cancelling`
- `completed`
- `failed`
- `cancelled`

The CLI and future Web UI can use these states to show user-visible progress.

## 9. Cancellation

Runs need a cancellation path.

MVP cancellation should:

- Stop future model/tool steps when possible
- Mark run as cancelled
- Persist a trace event
- Leave session history in a consistent state

Tool cancellation may be best-effort in MVP.

## 10. Approval Waiting

When a permission decision requires user approval, the run enters `waiting_for_approval`.

The run should preserve:

- Tool action
- Risk classification
- Approval prompt
- Timeout behavior, if any
- User approval or denial

Future adapters may handle approval asynchronously.

## 11. Steering Messages

OpenClaw-like systems may support steering messages while a run is active.

Vole should defer steering messages.

Future behavior may allow:

- User interrupts
- Additional instructions
- Run cancellation
- Priority updates

This should not be implemented until run state, trace, and session writes are stable.

## 12. Relationship to Session Storage

Run queue controls execution order.

Session storage persists the results.

Session storage should not decide scheduling. Run queue should not own durable transcript schema.

The boundary:

- Run queue: what runs now, waits, or stops
- Session storage: what gets written and loaded

## 13. Relationship to Execution Trace

Every run state transition should produce trace events.

Trace should include:

- Run accepted
- Run started
- Run waiting for approval
- Run resumed
- Run completed
- Run failed
- Run cancelled

This makes queue behavior visible to users.

## 14. Relationship to Background Automation

Background automation depends on run queue semantics.

Before implementing scheduled tasks or heartbeat behavior, Vole needs:

- Run IDs
- Run states
- Session serialization
- Approval waiting
- Cancellation
- Trace persistence

## 15. Testing Requirements

Run queue behavior needs tests because concurrency bugs are hard to debug.

Required test areas:

- Run ID creation
- One active run per session
- Ordered session writes
- Run state transitions
- Permission approval waiting state
- Cancellation behavior
- Trace events for run lifecycle
- Rejection or queuing of overlapping same-session runs
- Future global concurrency limits
- Future background run interactions

Run queue tests should be updated whenever session storage, execution trace, permissions, background automation, or adapters change.

## 16. Acceptance Criteria

MVP run queue design is successful when:

- Every run has a run ID.
- A CLI session has at most one active run.
- Run state is explicit.
- Session writes are ordered.
- Permission approval can pause a run.
- Cancellation leaves trace and session data consistent.
- Run lifecycle events appear in trace.
- Behavior is covered by unit and integration tests.

## 17. Related Documents

- [Agent loop](./agent-loop.md)
- [Session storage](./session-storage.md)
- [Execution trace](./execution-trace.md)
- [Permission system](./permission-system.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)
- [Main design](../product/vole-design.md)

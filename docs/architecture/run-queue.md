# Run Queue

Status: Active (Phase 0–10 shipped via SessionMutex; Phase 11 replaces it with lanes)
Date: 2026-05-11

Simplified Chinese version: [run-queue.zh-CN.md](./run-queue.zh-CN.md)

## 1. Purpose

The run queue controls how Vole accepts, orders, executes, and persists agent runs.

OpenClaw research shows that runs are serialized per session and coordinated through queues and session write locks. Vole adopts this architecture in stages: a single in-process `SessionMutex` through Phase 10, then a real three-tier lane system in Phase 11 (see [Lanes](./lanes.md) and [Gateway](./gateway.md)).

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

## 3. Phased Scope

Phase 0–10 shipped a single-process MVP with:

- Explicit run IDs
- One active run per CLI session (enforced by `SessionMutex`)
- In-memory run state
- Safe cancellation path
- Ordered session writes
- Trace events tied to run ID
- Background run scheduling via `vole daemon` (Phase 8)

Phase 11 expands this with:

- Three-tier lane admission (global / subagent / session) — see [Lanes](./lanes.md)
- Cross-process file lock around session JSONL writes
- Structured session keys (`agent:<id>:<lane-type>:<uuid>`)
- Gateway-mediated submit / cancel / subscribe — see [Gateway](./gateway.md)

Still deferred to later phases:

- Persistent / disk-backed queue (Phase 14 SQLite TaskFlow handles cross-session persistence)
- Remote node execution (Phase 17+)
- Run retry policy at the queue level
- Steering messages (Phase 12 introduces `subagents steer`; user-facing steering is later)

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

Vole serializes runs per session.

Rule:

Only one run should actively mutate a session at a time.

Through Phase 10 this was enforced by `SessionMutex` in `packages/sessions`. Phase 11 replaces the mutex with a session lane whose concurrency is fixed at 1; the lane is the strict generalization of the mutex. The user-visible behavior is identical: a second submit for the same session waits for the first to finish (queued, not rejected).

If a second run is requested for the same session, the system queues it on the session lane. Future phases may add steering paths that let an active run absorb new instructions instead of waiting in line.

## 6. Global Queue

Phase 11 introduces a global lane (default concurrency 16) plus a dedicated subagent lane (default concurrency 8). Every run passes through the global lane; sub-agent-initiated runs also pass through the subagent lane.

This bounds total concurrent work across:

- Multiple sessions
- CLI + Web running side by side
- Background automation
- Sub-agent spawns
- Future messaging channels

Configuration lives under `gateway.lanes.*`. Defaults match OpenClaw's documented limits and can be tuned per workspace.

## 7. Session Write Lock

Session write locks protect session history and trace persistence.

The lock ensures:

- Messages are appended in order.
- Tool observations attach to the correct run.
- Trace events remain ordered for a session.
- Compaction or memory flush does not race with normal writes.

Phase 0–10 relied on `SessionMutex` for in-process ordering. Phase 11 layers a process-aware file lock on top: the session lane orders writes within one Node process, while a `.lock` sidecar file (with PID + start time, 60 s acquire timeout) prevents a second `vole` process from interleaving writes on the same session JSONL. Stale locks (PID no longer alive) are reclaimed automatically.

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

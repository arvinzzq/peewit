# Phase 11: Gateway and Lanes

Status: Planned
Date: 2026-05-11

Simplified Chinese version: [phase-11-gateway-and-lanes.zh-CN.md](./phase-11-gateway-and-lanes.zh-CN.md)

## 1. Purpose

Phase 11 establishes the runtime infrastructure that every subsequent phase depends on: a real gateway layer with a three-tier lane queue system, normalized session key naming, and cross-process write locks.

Phases 0–10 wired CLI and Web adapters directly to `AgentRuntime` and used a single in-process `SessionMutex` for serialization. This is sufficient for one user with one shell but breaks down as soon as multiple entry points, sub-agents, or scheduled tasks compete for the same workspace. OpenClaw treats per-session and global lane queues as a baseline assumption; Vole needs to catch up before adding more agents, channels, or storage backends.

This phase is infrastructure-first. It produces no new user-facing tools by itself, but it unblocks Phase 12 (subagent maturity), Phase 14 (SQLite migration), and Phase 15 (channels and multi-agent identity).

## 2. Scope

This phase includes:

- `packages/gateway`: expand `SessionGateway` from a session registry into a `GatewayCore` with submit / subscribe / cancel methods.
- `packages/lanes`: new package exporting `Lane`, `LaneRegistry`, and the three default lane tiers (global, subagent, session).
- `packages/sessions`: add cross-process file lock around session JSONL writes using a `proper-lockfile`-style helper.
- Replace `SessionMutex` usage with session lane (concurrency = 1) and deprecate the standalone mutex.
- Normalize session key format to `agent:<agentId>:<lane-type>:<uuid>`; embed parent / child relationship in the key for future subagent work.
- CLI inspection command: `vole gateway status` to print lane occupancy and queued runs.
- Update `gateway.md`, `run-queue.md`, and new `lanes.md` architecture docs.

This phase does not include:

- Remote RPC exposure of the gateway (no HTTP / Unix socket transport).
- Multi-process gateway daemon.
- Channel integration (Phase 15).
- SQLite migration (Phase 14).
- Subagent push completion (Phase 12).

## 3. Architecture Summary

### GatewayCore

`GatewayCore` is the single point of entry for any run. CLI and Web adapters stop constructing `AgentRuntime` directly and instead call `gateway.submit(runRequest)`. The gateway resolves the target session, routes the request through the appropriate lane, and returns an event stream.

```ts
interface GatewayCore {
  submit(req: RunRequest): AsyncIterable<RuntimeEvent>;
  subscribe(sessionId: string): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  status(): GatewayStatus;
}
```

The existing `SessionGateway` registry is folded into `GatewayCore` as its session metadata store. No remote RPC is added.

### LaneRegistry

A `Lane` is a FIFO queue with a configurable concurrency limit. Submitted work waits if the limit is reached and runs as slots free up.

Three default lane tiers:

| Lane | Default concurrency | Scope |
| --- | --- | --- |
| `global` | 16 | All work, regardless of session |
| `subagent` | 8 | Subagent-spawned runs only |
| `session:<sessionId>` | 1 | Per-session strict serialization |

A run must pass all applicable lanes (global gate, possibly subagent gate, and exactly one session lane). Per-session concurrency 1 reproduces the current `SessionMutex` semantics with no behavior change.

### Session Key Naming

Sessions are renamed from opaque UUIDs to a structured key:

```text
agent:<agentId>:main                                  # Top-level user session
agent:<agentId>:subagent:<uuid>                       # Phase 12 subagent
agent:<agentId>:subagent:<uuid>:subagent:<uuid>       # Depth-2 nested (Phase 12)
agent:<agentId>:background:<uuid>                     # Scheduler-launched
```

The key encodes the lane membership and parent relationship without requiring a separate metadata field. Existing sessions get a one-time migration: their UUID becomes the trailing segment and `agentId` defaults to `default`.

### Cross-Process File Lock

The session lane prevents in-process races but does not stop a second `vole` invocation from writing the same JSONL. Phase 11 adds a `acquireSessionFileLock(sessionId, options)` helper that:

- Uses a sidecar `.lock` file in the sessions directory.
- Process-aware: writes PID and start time; stale locks (PID dead) are reclaimed.
- Configurable acquire timeout, default 60000 ms.
- Wraps every JSONL append in `packages/sessions`.

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `lanes.md` + zh-CN, `gateway.md` rewrite + zh-CN, `run-queue.md` update + zh-CN, roadmap update — docs:check must pass.
2. **feat(lanes)**: new `packages/lanes` with `Lane`, `LaneRegistry`, tests.
3. **feat(gateway)**: `GatewayCore` consolidating session registry + lane routing + cancellation, tests.
4. **feat(sessions)**: cross-process file lock, integration with existing JSONL store, tests.
5. **refactor(cli,web)**: migrate adapters to submit through gateway; remove direct `AgentRuntime` construction; remove `SessionMutex` usage.
6. **feat(cli)**: `vole gateway status` command.
7. **docs**: mark Phase 11 complete with commit hashes.

## 5. Acceptance Criteria

- `pnpm run check` and `pnpm run check:bundle` pass at every commit.
- A test fires 100 parallel submits to one session lane; all runs complete in submission order with no JSONL corruption.
- A test runs two `vole` processes against the same session concurrently; the file lock serializes them and neither loses writes.
- `vole gateway status` prints active lane occupancy and pending queue depth.
- Removing `SessionMutex` does not change observable behavior of single-session CLI use.
- New session key format is backwards-compatible: old sessions remain readable and are migrated lazily on first write.

## 6. Non-Goals

- No gateway HTTP / Unix socket transport.
- No multi-process gateway daemon.
- No remote client protocol.
- No new permission semantics.
- No SQLite (Phase 14).
- No subagent behavior changes beyond preparing the session key shape (Phase 12).

## 7. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Gateway](../architecture/gateway.md)
- [Run Queue](../architecture/run-queue.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.md)
- [OpenClaw Alignment Plan](./openclaw-alignment.md)

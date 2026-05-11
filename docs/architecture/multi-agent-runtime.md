# Multi-Agent Runtime

Status: Phase 10 baseline; Phase 12 hardens push completion, fork mode, depth/concurrency policy, and a `subagents` management surface
Date: 2026-05-11

Simplified Chinese version: [multi-agent-runtime.zh-CN.md](./multi-agent-runtime.zh-CN.md)

> **Phase 15 update**: "multi-agent" gains its second axis. Until Phase 14 it meant "one parent spawns sub-agents inside one process"; Phase 15 introduces independent agent *identities* under `agents/<agentId>/`, each with its own SOUL.md, AGENTS.md, USER.md, MEMORY.md, and credentials. The runtime still drives a single `AgentRuntime` per turn — what changes is which identity subtree the context assembler reads from. Channels (Telegram, email, etc.) attach to an `agentId` and route inbound messages through `GatewayCore.submit` with the same session-lane admission. See [Phase 15 plan](../plans/phase-15-channels-and-multi-agent-identity.md) and the new [channels architecture doc](./channels.md).

## 1. Purpose

This document describes how Vole supports running multiple `AgentRuntime` instances in a coordinated way. Phase 10 introduced in-process sub-agents with a pull-based completion model; Phase 12 makes the system production-shaped: completion is pushed back to the parent automatically, a `fork` context mode copies the parent transcript, lane admission enforces a per-parent child cap and an OS-level timeout, and a `subagents` tool family / CLI surface makes the runtime inspectable and controllable.

Sub-agents still run in-process. Cross-process or cross-machine dispatch is explicitly out of scope through Phase 16.

## 2. Sub-Agent Concept

A sub-agent is a second `AgentRuntime` instance spawned by a parent agent to handle a focused subtask. The parent delegates a goal; the sub-agent runs with its own session lane, its own tool set, its own step limit, and (optionally) its own copy of the parent's transcript.

Two context modes:

- **`isolated`** (default) — the sub-agent session is empty except for the `goal` and an optional `context` string. Cheap in tokens; the right choice when the work is self-contained.
- **`fork`** — the parent's recent assistant/user messages are copied into the sub-agent session before the first turn runs. More expensive in tokens; the right choice when the work depends on context the parent has already accumulated. Tool call records are not forked by default, to keep token use bounded.

Sub-agents are useful when:

- The subtask requires a separate focused execution context.
- The parent wants to hand off a well-defined bounded goal in parallel.
- The parent does not want its own conversation history polluted by intermediate steps.

## 3. SubagentFactory Interface

The factory accepts an options bag so the gateway and the tool layer can place a child sub-agent into the correct context, at the correct depth, and under the correct session key:

```ts
export interface SubagentFactoryOptions {
  contextMode?: "isolated" | "fork";
  parentMessages?: ReadonlyArray<{ role: string; content: string | null }>;
  depth?: number;
  parentSessionKey?: string;
}

export interface SubagentFactory {
  create(goal: string, options?: SubagentFactoryOptions): AgentRuntime;
}
```

The factory is constructed once by the adapter (CLI or Web) with config / provider / built-in tools. Each call to `create` builds a fresh `AgentRuntime`:

- When `contextMode === "fork"`, the factory passes the supplied `parentMessages` to the runtime as `recentMessages` before the first turn.
- When `depth >= maxSpawnDepth` (1 by default; 2 for orchestrators), the factory strips `spawn_subagent`, `spawn_subagent_async`, and `subagents` from the tool list before constructing the runtime. The model literally cannot recurse below the allowed depth.
- `parentSessionKey` is used to derive the child session key (`<parent>:subagent:<uuid>`).

The factory does not enforce concurrency caps — that is the gateway's job (see §6).

## 4. Spawn Tools

Four model-callable tools live in `@vole/tools` and `@vole/core`:

| Tool | Risk | Use when | Returns |
|---|---|---|---|
| `spawn_subagent` | medium | Subtask must finish before the parent can continue | `{ ok, result }` after the child returns |
| `spawn_subagent_async` | medium | Subtask can run in the background | `{ taskId, status: "queued" }` immediately |
| `check_subagent` | low | Parent wants to poll a previously spawned async child | `{ status, result }` |
| `subagents` | low | Parent (or human) wants to list / inspect / control children | command-shaped response |

`subagents` is the admin family added in Phase 12. Its commands:

```ts
{ command: "list" }                  → { children: RunHandle[] }
{ command: "log",   taskId }         → { events: ... }       // not yet implemented; reserved
{ command: "info",  taskId }         → { record: ... }
{ command: "kill",  taskId | "all" } → { stopped: string[] }
{ command: "steer", taskId, message }→ { delivered: bool }   // reserved for Phase 15 channels
{ command: "send",  taskId, message }→ { delivered: bool }   // reserved
```

Killing cascades through the session-key tree, so killing a depth-1 orchestrator stops every depth-2 child it spawned.

## 5. Push-Based Completion

In Phase 10 the parent had to poll `check_subagent`. Phase 12 inverts that: when an async sub-agent finishes, it writes a `pendingAnnouncementForParent` entry on the parent's TaskFlow record. The parent's next `runTurn` drains the pending list before assembling the system prompt and injects each entry as a `system` role message:

```text
[subagent #abc123 completed]
goal: Refactor authentication middleware
status: succeeded
result: <terminal summary>
```

Delivery rules:

- Each entry carries the `taskId` as an idempotency key. Once injected, it is cleared so the parent never sees the same announcement twice.
- Failed and timed-out children produce announcements with `status: "failed"` / `status: "timed_out"` and a short terminal summary instead of a raw stack.
- Sub-agents emitting the silent token `NO_REPLY` (or `no_reply`) as their assistant text suppress the announcement entirely — useful for fire-and-forget background work that should not interrupt the parent.

The parent can still call `check_subagent` for explicit polling; the push path is additive, not exclusive.

## 6. Concurrency, Depth, and Timeout Policy

Three policy layers stack on top of the `@vole/lanes` admission chain:

| Layer | Default | Owned by | Behavior |
|---|---|---|---|
| Global lane | 16 concurrent | `LaneRegistry` (Phase 11) | Total parallel work across all runs |
| Subagent lane | 8 concurrent | `LaneRegistry` (Phase 11) | Total parallel sub-agent runs |
| Per-parent counter | `maxChildrenPerAgent: 5` | `GatewayCore` (Phase 12) | Active children for one parent session |
| Spawn depth | `maxSpawnDepth: 1` (orchestrator: 2; hard cap: 5) | `SubagentFactory` (Phase 12) | How deep recursion may go |
| Run timeout | `runTimeoutSeconds: 0` (off) | `GatewayCore` (Phase 12) | Wall-clock budget per child run |

Per-parent admission happens before the lane chain: a 6th concurrent child for one parent queues at the gateway, not at the subagent lane. This keeps one runaway parent from starving every other parent on the subagent lane.

Depth enforcement is structural: the factory simply removes spawn tools from the tool list when depth equals the cap. The model cannot call what it does not have.

Run timeout is implemented as an `AbortController` armed with `setTimeout`. When the timer fires, the gateway calls `cancel(runId)`, which aborts the run at the next safe checkpoint and surfaces a `timed_out` status in the announcement.

## 7. References

- [Lanes](./lanes.md) — admission and serialization primitive
- [Gateway](./gateway.md) — submit / cancel / status surface
- [Task Flow](./task-flow.md) — TaskFlow records and the pendingAnnouncementForParent field
- [Agent Loop](./agent-loop.md) — the runtime loop sub-agents run
- [Phase 12 Plan](../plans/phase-12-multi-agent-runtime-maturity.md)

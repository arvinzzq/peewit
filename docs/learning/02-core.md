# Module 11: @vole/core

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `02-core.zh-CN.md` (create alongside this file)

Related source: `packages/core/src/index.ts`

## 0. How to Use This Document

This document is the output of Stage 2 in the [learning guide](./guide.md). It covers
`@vole/core` — the center of the entire system. Read this before any other module doc.

**Before reading**: Build the Stage 1 mental model first ([01-concepts.md](./01-concepts.md)).
Then read these primary sources:

1. `docs/architecture/agent-loop.md` — section 15 (interface definitions and event types)
2. `packages/core/src/index.ts` — start with the exported `runtimeEventTypes` array, then
   `AgentRuntimeDependencies`, then `runTurn`
3. `packages/core/src/index.test.ts` — read test names before reading implementations;
   the `describe` / `test` labels describe every behavior the module guarantees

**Focus questions**: Answer these while reading the source:
- What are the 19 `RuntimeEventType` values and in what order do they appear in a normal run?
- Why does `runTurn` return `AsyncGenerator<RuntimeEvent>` instead of `Promise<RuntimeEvent[]>`?
- Where exactly in the loop does permission evaluation happen?
- Why is `ContextAssembler` injected rather than constructed inside `AgentRuntime`?
- What triggers `planning_stall_detected` and what happens after it fires?

**Checkpoint**: You have understood this module when you can trace a complete run — from
`runTurn(input)` call to `run_completed` — naming every event emitted and every decision
point the loop passes through.

## 1. What This Module Does

**Plain language**: Think of `@vole/core` as a project manager. When you give it a task, it
doesn't do the work itself — it coordinates specialists:

1. "Context team, prepare the briefing for the model"
2. "Model, what should we do next?"
3. "Permission team, is this action allowed?"
4. "Tool team, execute the action"
5. "Context team, add the result to the briefing"
6. Back to step 2 — until the task is done

At every step, it broadcasts what is happening (events) so that any observer — the CLI,
the web UI, a trace logger — can react in real time without being wired into the loop itself.

**Technical summary**: `@vole/core` runs the agent turn loop. It receives a user message,
coordinates context assembly, model inference, permission evaluation, and tool execution in
a cycle — emitting a stream of 19 observable event types at each step.

It is the center of the entire system. Every other package exists either to serve this loop
or to stay out of it.

## 2. Why It Exists

Without a dedicated runtime loop, every adapter (CLI, web, desktop) would need to implement
its own model call / tool dispatch / permission logic. That would mean duplicated behavior and
inconsistent safety guarantees.

`@vole/core` is the single, shared implementation of "what an agent turn does." Adapters
consume its event stream without reimplementing the loop.

## 3. Public Interface

```ts
class AgentRuntime {
  constructor(dependencies: AgentRuntimeDependencies)
  runTurn(input: AgentRuntimeInput): AsyncIterable<RuntimeEvent>
}

interface AgentRuntimeDependencies {
  contextAssembler: ContextAssembler   // required — assembles context before each model call
  modelProvider: ModelProvider         // required — vendor-agnostic model interface
  systemInstruction: string            // required — base system prompt text
  permissionPolicy?: PermissionPolicy  // optional — defaults to DefaultPermissionPolicy
  approvalResolver?: ApprovalResolver  // optional — handles "ask" decisions with the user
  tools?: ExecutableTool[]             // optional — registered tools
  maxSteps?: number                    // optional — default 12
  executionContract?: ExecutionContract // "default" | "strict-agentic"
  sessionMutex?: SessionMutex          // optional — prevents concurrent runs per session
  hooks?: AgentHooks                   // optional — beforeTurn, afterTurn, beforeToolCall, etc.
}

interface AgentRuntimeInput {
  message: string
  sessionId?: string
  recentMessages?: ModelMessage[]
}
```

Key point: `AgentRuntime` takes all its dependencies from the outside. It constructs nothing
itself except the internal `update_todos` tool. This makes it fully testable with fakes.

## 4. Implementation Walkthrough

`runTurn` is an `async *` generator that yields `RuntimeEvent` values. Callers consume it
with `for await`:

```ts
for await (const event of runtime.runTurn(input)) {
  // stream each event to the adapter
}
```

The generator proceeds through these phases on every call:

**Phase 1 — Mutex acquisition (line ~390)**
If `sessionMutex` is provided, `runTurn` acquires the session lock before any work begins.
This ensures only one turn runs per session at a time. The lock is released in the `finally`
block, even if the turn fails mid-way.

**Phase 2 — Startup (lines ~411–429)**
Emits `run_started`. Calls `contextAssembler.assemble()` with the system instruction, skill
index, tool summaries, permission guidance, and user message. Emits `context_assembled`.

**Phase 3 — The while loop (line ~442)**
Runs up to `maxSteps` (default 12) iterations. Each iteration:

1. Optionally compacts message history if configured. If compaction runs and succeeds,
   emits a `compaction_triggered` event including a `summary: string` field containing
   the distilled summary text extracted from the compacted messages.
2. Emits `model_request_started`
3. Calls the model (streaming or non-streaming depending on `preferStreaming`)
4. Emits `model_request_completed`
5. Branches on output type:

**Branch A — model returns a plain message**

The runtime checks for planning stalls before accepting the message as the final answer.
`isPlanningOnly()` scans for promise language ("I'll…", "let me…"), plan headings ("Plan:",
"Steps:"), and bullet/numbered lists. A 700-character length cap and completion-language
check (`done`, `fixed`, `found`) prevent false positives.

If a stall is detected: emits `planning_stall_detected`, appends a retry instruction to the
messages, and continues the loop. If stalls exceed `maxPlanningStallRetries`: emits
`run_failed` and returns.

If no stall: emits `assistant_message_created`, then `turn_complete` (carrying the full
list of new messages from this turn — user, tool_use, tool_result, and final assistant),
then `run_completed` and returns.

**Branch B — model returns tool calls**

For each call in the batch:

1. Look up the tool in the registry. If missing: emit `tool_failed`, push error text to tool
   results, **continue** (model will see the error on the next step).
2. Evaluate permission. Emit `tool_call_permission_evaluated`.
3. If `deny`: set `hardTerminate = true` and break the tool loop.
4. If `ask`: emit `approval_requested`, call `approvalResolver.resolve()`, emit
   `approval_resolved`. If not approved: set `hardTerminate = true` and break.
5. Run `beforeToolCall` hook. If it returns `"abort"`: emit `tool_failed`, push error, continue.
6. Emit `tool_started`. Execute `tool.execute()`. On success: emit `tool_completed`, push result.
   On exception: emit `tool_failed`, push error text, **continue** (model will see the error).
7. Run `afterToolCall` hook.

After the tool loop: if `hardTerminate`, emit `run_failed` and return. Otherwise append all
tool results to messages and go back to step 3 of the while loop.

**Phase 4 — Step limit**
If the while loop exhausts `maxSteps`, emit `run_failed` with a step-limit message.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| `pi-embedded-runner.ts` | `AgentRuntime.runTurn` | Core loop structure |
| `incomplete-turn.ts` | `isPlanningOnly()` | Stall detection regex patterns |
| `lanes.ts` (per-session queue) | `SessionMutex` | Serializes turns per session |
| `update_plan` tool | `update_todos` (built-in) | Full-replace todo list, model-called |
| `agent-command.ts` | `AgentRuntimeDependencies` wiring | Dependency injection at entry point |

The `executionContract: "strict-agentic"` setting mirrors OpenClaw's strict-agentic mode:
it appends an instruction to the system prompt ("Act immediately. Do not narrate plans.") and
increases the planning stall retry budget from 2 to 3.

Divergence: OpenClaw's `update_plan` tool is disabled by default and opt-in per model.
Vole's `update_todos` is always registered and always available.

## 6. Key Design Decisions

**AsyncGenerator, not Promise**

`runTurn` returns `AsyncIterable<RuntimeEvent>` rather than `Promise<RuntimeEvent[]>`. This
lets adapters observe the loop while it is running — streaming tokens, showing permission
prompts, displaying tool progress — without waiting for the entire turn to complete.

**`deny` is a hard stop; tool errors are not**

A `deny` permission decision triggers `run_failed` immediately (the model never sees it).
A tool error — unknown tool, execution exception — is returned to the model as a tool result
message. The model can then decide what to do next.

This asymmetry is intentional: `deny` means a human or policy said "stop"; tool errors are
environmental and the model may have valid recovery options.

**`update_todos` is always registered**

The `update_todos` tool is created in the constructor and merged into the tool map before
any user-provided tools. There is no way to disable it. This ensures every `AgentRuntime`
instance can receive and expose in-turn progress.

**`hadRealToolCallThisTurn` guard**

Once any non-`update_todos` tool has executed, subsequent plain-text responses are never
flagged as planning stalls. This prevents the stall detector from mis-firing when the model
writes a summary after completing real work.

## 7. Testing Approach

Tests are in `packages/core/src/index.test.ts`. The test approach uses:

- `FakeModelProvider` from `@vole/models` — returns scripted sequences of tool calls and
  messages without hitting any API
- Inline `PermissionPolicy` implementations — return specific decisions for specific tools
- `InMemoryRuntimeTraceStore` — collects events for assertion

Test categories:
- Basic message round-trip (no tools)
- Tool call → result → second model call
- Permission allow / deny / ask flows
- Planning stall detection (single stall, max retries, completion-language bypass)
- `update_todos` emits `todos_updated` event
- Max steps termination
- `SessionMutex` prevents concurrent turns
- Streaming path (via `FakeStreamingModelProvider`)

## 8. Insights

**The loop is a while loop with a permission gate.** Once you strip away the event emission
and hooks, the core loop is simple: call the model, execute tools if requested, repeat.
The sophistication is all in the constraints: bounded steps, observable events, serialized
sessions, safe tool execution.

**`deny` stops the run; tool errors do not.** A common initial assumption is that any failure
should stop the loop. The actual behavior is more nuanced: tool errors (unknown tool, execution
exception) are returned to the model as tool result messages. Only explicit `deny`/`block`
decisions and infrastructure errors trigger `run_failed`. The model is expected to be the
decision-maker for tool-level failures.

**Planning stall detection is conservatively tuned.** Multiple guards prevent false positives:
a 700-character length cap, a completion-language bypass, and an action-verb requirement when
no structured plan format is present. The goal is to catch only the "narrating a plan without
acting" pattern, not to flag summaries or short conversational replies.

**The mutex is lock-free.** `SessionMutex` implements per-session serialization using a
promise chain — no external synchronization primitives. Each `acquire()` appends to the chain
and returns a `release` function that advances it.

## 9. Review Questions

1. What is the single responsibility of `@vole/core`? What does it explicitly NOT own?
   > Runs the agent turn loop — context assembly, model inference, permission evaluation, tool
   > execution. Does NOT own: adapter rendering, vendor API SDKs, session persistence, or
   > skill loading. POS comment: "coordinates a turn without owning adapters or vendor APIs."

2. Why does `runTurn` use `AsyncGenerator` instead of `Promise<RuntimeEvent[]>`?
   > Adapters need to observe the loop while it is running — stream tokens, show permission
   > prompts, display tool progress. A `Promise<RuntimeEvent[]>` would buffer everything and
   > deliver it only after the turn completes, making streaming and interactive approval impossible.

3. A tool call fails with an execution exception. Does the run terminate? What does the model
   see on the next step?
   > The run does NOT terminate. The exception is caught, `tool_failed` is emitted, and the
   > error message is pushed to `toolResultMessages` as a `{ role: "tool" }` message. On the
   > next model call, the model sees: `Error: <exception message>`. It can then decide to retry,
   > use a different tool, or report the problem.

4. A tool call returns `deny` from the permission policy. What events are emitted? Does the
   model see the denial?
   > Events: `tool_call_permission_evaluated` (with `decision: deny`), then `run_failed`.
   > The model does NOT see the denial — `hardTerminate` is set immediately and the run ends
   > before the tool result is assembled into messages.

5. What is `hadRealToolCallThisTurn` for, and why does it skip stall detection after real
   tool use?
   > It tracks whether any non-`update_todos` tool executed in the current turn. Once real
   > work has happened, a subsequent plain-text message is a result report — not a planning
   > stall. Without this guard, the model's summary after completing a task would be mis-flagged
   > as a plan narration.

6. What would happen if you passed `executionContract: "strict-agentic"` to a session where
   the model tends to write long planning summaries?
   > The system prompt gets an appended instruction: "Act immediately. Do not narrate plans."
   > The stall retry budget increases from 2 to 3. However, responses longer than 700
   > characters are never flagged as stalls — so long summaries would not trigger stall
   > detection regardless of the contract.

7. How does `SessionMutex` work? What problem would occur without it in a multi-turn session?
   > It builds a promise chain per `sessionId`. Each `acquire()` waits for the previous
   > promise to resolve before proceeding, then returns a `release` function. Without it, two
   > concurrent callers (e.g. CLI and a background scheduler) could run `runTurn` simultaneously
   > on the same session, causing interleaved message history and corrupted session state.

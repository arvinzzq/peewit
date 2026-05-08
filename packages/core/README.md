# Core Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/core` is the agent runtime orchestration layer. It sits at the center of the package graph, consuming all other domain packages and exposing a single unified runtime to adapters (CLI, Web) above it.

```
CLI / Web adapter
        │
        ▼
   AgentRuntime          ← @vole/core
  ├─ ContextAssembler    (@vole/context)
  ├─ ModelProvider       (@vole/models)
  ├─ PermissionPolicy    (@vole/permissions)
  └─ ExecutableTool[]    (@vole/tools)
```

The core must remain **adapter-agnostic** (no terminal rendering, no HTTP) and **vendor-agnostic** (no Anthropic or OpenAI SDK imports). Adapters call `AgentRuntime.runTurn()` and consume `RuntimeEvent` objects from its async generator.

### createAgent() — Primary Entry Point

`createAgent()` is the preferred way to construct an agent. It wraps `new AgentRuntime()` with safe defaults so you only specify what you need:

```typescript
import { createAgent } from "@vole/core";

// Layer 0 — bare loop
const agent = createAgent({ model: provider });

// Layer 1 — add tools
const agent = createAgent({ model: provider, tools: [readFileTool], permissions: new AlwaysAllowPolicy() });

// Full composition
const agent = createAgent({
  model: provider,
  systemInstruction: "You are Vole.",
  tools: allTools,
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: cliResolver,
  context: new DefaultContextAssembler({ workspaceFiles: ["AGENTS.md"] }),
  compaction: { maxTokens: 60_000 },
});
```

All fields except `model` are optional. Sessions are caller-managed: pass `recentMessages` to `runTurn()` and persist the new messages from the `turn_complete` event. See [Progressive Composition](../../docs/architecture/progressive-composition.md) for the full layer model.

## Core Concepts

### RuntimeEvent System

Every observable action the agent takes during a turn emits a typed `RuntimeEvent`. There are 19 event types that form a strict lifecycle state machine:

```
run_started
  → context_assembled
  → model_request_started
    → token_delta*          (only with preferStreaming)
  → model_request_completed
    → tool_call_requested
    → tool_call_permission_evaluated
      → [approval_requested → approval_resolved]   (if decision = "ask")
    → tool_started → tool_completed | tool_failed
  → todos_updated            (if update_todos was called this step)
  → [planning_stall_detected → ...]  (if stall detected)
  → assistant_message_created
  → turn_complete            (carries all new messages from this turn)
run_completed | run_failed
```

`turn_complete` is emitted on the success path only, immediately before `run_completed`. It carries the full list of new messages generated during the turn — including `user`, `tool_use`, `tool_result`, and the final `assistant` message. Adapters use this event to persist the complete tool call context to the session store.

`isTerminalRuntimeEvent(event)` returns `true` for `run_completed` and `run_failed`. Adapters use this as the stop signal when iterating the generator. `InMemoryRuntimeTraceStore` provides a default in-process store; adapters can inject alternatives (e.g. writing events to the session store).

### AgentRuntime — Multi-Step Loop

`AgentRuntime.runTurn(input)` is an `AsyncIterable<RuntimeEvent>`. Each invocation is one user-turn. The loop:

1. Acquires `SessionMutex` for the session ID (serializes concurrent calls on the same session).
2. Invokes the `beforeTurn` hook (errors are silently isolated).
3. Calls `ContextAssembler.assemble()` to build the `ModelInput` from system instruction, runtime metadata, tools, skills, permission guidance, conversation history, and the user message.
4. Enters a `while (steps < maxSteps)` loop:
   - Optionally compacts message history if `compaction` is configured and `messages.length > maxMessages`.
   - Calls `ModelProvider.generate()` or `generateStream()` (streaming path).
   - On `type: "message"`: checks for planning stall, emits `assistant_message_created` + `run_completed`, exits.
   - On `type: "tool_calls"`: evaluates each call through `PermissionPolicy`, runs approved tools, accumulates `tool` role messages, repeats.
5. If `maxSteps` is reached, emits `run_failed`.
6. Always releases the `SessionMutex` in a `finally` block.
7. Invokes `afterTurn` hook with the full list of collected events (errors are silently isolated).

### Planning Stall Detection

When the model responds with a text message that looks like a narrated plan rather than a tool call, the runtime detects a "stall" using an OpenClaw-aligned guard chain. There are two levels of guards:

**Turn-level guard (checked before text analysis)**

- **`hadRealToolCallThisTurn`** — if any non-`update_todos` tool was called earlier in this turn, the subsequent message is reporting results, not planning. Stall detection is skipped entirely. Mirrors OpenClaw's `hasNonPlanToolActivity` check: a model that already did real work cannot be stalling.

**Text-level guards (applied to the message content)**

1. **Length guard** (`PLAN_MAX_CHARS = 700`) — responses longer than 700 characters are almost certainly result reports, not plans.
2. **Code block guard** — any response containing ` ``` ` is never a planning stall.
3. **`PLAN_COMPLETION_RE`** — if the response contains completion language (`done`, `finished`, `implemented`, `found`, `here's what`, `verified`, `ran`, …) the model has already acted; never a stall.
4. **`PLAN_PROMISE_RE`** — explicit future-action commitments ("I'll", "let me", "I'm going to", …).
5. **`hasStructuredPlanFormat`** — structured plan = explicit heading (`Plan:`, `Steps:`, `Next steps:`) + promise language, _or_ ≥2 bullet/numbered lines + promise language. Structured format alone is sufficient for stall detection.
6. **`PLAN_ACTION_VERB_RE`** — for unstructured (no heading/bullets) messages, a concrete action verb (`read`, `search`, `implement`, `investigate`, …) is required alongside promise language — this prevents vague filler phrases like "let me think about this" from triggering.

On stall detection, the runtime emits `planning_stall_detected` and injects a retry instruction: _"Do not restate the plan. Act now: take the first concrete tool action you can."_ After `maxPlanningStallRetries` consecutive stalls, the run fails. The stall counter resets whenever the model successfully calls a tool or generates a non-stall message.

### SessionMutex

Concurrent calls to `runTurn` with the same `sessionId` are serialized via a chained Promise queue. Different sessions run in parallel without contention.

```typescript
const mutex = new SessionMutex();
// Same session → queued sequentially
const release1 = await mutex.acquire("sess_A");
const release2 = await mutex.acquire("sess_A");   // waits for release1
// Different sessions → concurrent
const releaseB = await mutex.acquire("sess_B");   // does not wait
```

The map entry is cleaned up automatically once no waiters remain.

### AgentHooks

Hooks provide lifecycle interception without subclassing:

| Hook | When fired | Can abort execution? |
|---|---|---|
| `beforeTurn(input)` | Before context assembly | No — errors isolated |
| `afterTurn(events)` | After run_completed or run_failed | No — errors isolated |
| `beforeToolCall(call)` → `"abort"` | Before each tool executes | Yes — returning `"abort"` emits `tool_failed` and skips execution |
| `afterToolCall(call, result)` | After each tool completes | No — errors isolated |
| `onCompaction(before, after)` | After message history is compacted | No — errors isolated |

`compaction_triggered` events now include a `summary: string` field. On a Phase 2 success this contains the summary text extracted from the compacted messages; the adapter uses it to call `appendCompactBoundary()` on the session store.

All hook errors are caught with `console.warn` in non-production environments.

### ExecutionContract

Two runtime execution contracts affect system instructions and stall tolerance:

| Contract | `maxPlanningStallRetries` | System instruction suffix |
|---|---|---|
| `"default"` | 2 | _(none)_ |
| `"strict-agentic"` | 3 | `"Execution contract: strict-agentic. Act immediately. Do not narrate plans. Call tools now."` |

### Subagent Tools

Both subagent tools live in `core` (not `tools`) to avoid a circular import with `AgentRuntime`:

- **`createSpawnSubagentTool(factory)`** — synchronous: runs a sub-`AgentRuntime` to completion, returns the assistant text or error.
- **`createSpawnSubagentAsyncTool(factory, options)`** — fire-and-forget: creates a `taskId`, optionally records to `AsyncTaskStore`, launches sub-agent in the background, and returns immediately with `{ taskId, status: "queued" }`.

### update_todos (Built-in Tool)

`update_todos` is always registered as the first tool, before any user-supplied tools. When called, it updates `#currentTodos` in the runtime. After each tool-call batch that includes `update_todos`, the runtime emits a `todos_updated` event with the new todo list.

## Implementation Principles

### Streaming Path

When `preferStreaming = true` and the provider satisfies `isStreamingProvider(provider)`, the runtime calls `generateStream`. It accumulates token deltas (`token_delta` events are yielded immediately) and reconstructs a `ModelOutput` at stream end. Tool call arguments are accumulated incrementally across chunks and parsed once the stream closes.

### Permission Flow Per Tool Call

```
tool call requested
  → permissionPolicy.evaluate({ mode, action: { kind:"tool", name, risk } })
    → "allow"  → execute immediately
    → "deny"   → emit run_failed (hard terminate, no more calls in batch)
    → "ask"    → emit approval_requested
                 → approvalResolver.resolve(request)
                   → approved: true  → execute
                   → approved: false → emit run_failed (hard terminate)
```

### Tool Context

Every `ExecutableTool.execute(input, context)` receives a `ToolExecutionContext` with `workspaceRoot` set to `this.#runtime?.workspace ?? process.cwd()`. This allows tools to resolve paths relative to the configured workspace without depending on global state.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the core package and workspace dependencies on context, models, permissions, and tools. |
| `tsconfig.json` | TypeScript config | Builds core with project references to all dependency packages. |
| `src/index.ts` | Runtime core | All exports: `createAgent`, `CreateAgentOptions`, 19 event types and unions, `AgentRuntime`, `AgentRuntimeDependencies`, `SessionMutex`, `AgentHooks`, `ExecutionContract`, `InMemoryRuntimeTraceStore`, `RuntimeTraceStore`, `ApprovalResolver`, `SubagentFactory`, `createSpawnSubagentTool`, `createSpawnSubagentAsyncTool`, `AsyncTaskStore`. |
| `src/index.test.ts` | Runtime tests | Full behavioral test suite: all event paths, permission policy, approval, hooks, stall detection, streaming, subagent tools, `SessionMutex` concurrency, `ExecutionContract` behavior. |
| `src/create-agent.test.ts` | Progressive composition tests | Layer-isolated tests: Layer 0 (bare loop), Layer 1 (tool dispatch), Layer 2 (permission evaluation), Layer 3 (session messages), Layer 4 (context assembler), multi-layer combinations. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

# Progressive Composition

Status: Stable
Date: 2026-05-11

Simplified Chinese version: [progressive-composition.zh-CN.md](./progressive-composition.zh-CN.md)

## 1. Purpose

Progressive composition is the principle that a Vole agent can be assembled from any subset of its modules. The simplest runnable configuration is a single model provider and nothing else. Additional modules can be added one at a time, each with an explicit minimal or null implementation when not needed.

This makes the architecture:

- **Testable from Layer 0**: a bare loop with a fake model runs without any real dependencies.
- **Pedagogically clear**: each module can be understood in isolation before the full system is assembled.
- **Resistant to coupling**: if a module cannot be removed cleanly, that signals a boundary violation.

## 2. The Layer Model

Six layers, ordered by dependency:

| Layer | Adds | Required by |
|---|---|---|
| 0 — Bare loop | model → output → repeat | `ModelProvider` |
| 1 — Tools | model can call registered tools | Layer 0 + `ExecutableTool[]` |
| 2 — Permissions | tool calls evaluated before execution | Layer 1 + `PermissionPolicy` |
| 3 — Sessions | conversation persists across turns | External `SessionStore` (caller-managed) |
| 4 — Context | rich system prompt, workspace files, compaction | Layer 0 + `ContextAssembler` |
| 5 — Multi-agent | agent can spawn focused sub-agents | Layer 1 + subagent tools |

Layers are not strictly sequential. Layer 4 does not require Layers 1–3. Any combination is valid as long as its dependencies are satisfied.

## 3. Dependency Graph

```
model ──────────────────────────────────────────────────────┐
tools (optional) ───────────────────────────────────────────┤
permissions (optional, meaningful only when tools present) ──┤──► AgentRuntime
sessions (optional, external — caller manages) ──────────────┤
context (optional) ─────────────────────────────────────────┤
multi-agent tools (optional, subset of tools) ───────────────┘
```

Acceptable cross-layer dependencies:

- `permissions` is most useful when `tools` is present — no tools means no actions to evaluate.
- `multi-agent` tools require the caller to provide a `SubagentFactory` that constructs `AgentRuntime` instances, making the composition recursive.
- `sessions` are always managed externally; `AgentRuntime.runTurn()` accepts `recentMessages` as input and emits `turn_complete` with the new messages for the caller to persist.

## 4. The createAgent() Factory

`createAgent()` is the primary entry point for assembling an agent at any layer. It wraps `new AgentRuntime()` with safe defaults and a flatter API that maps cleanly onto the layer model:

```ts
import { createAgent } from "@vole/core";
import { FakeModelProvider } from "@vole/models";

// Layer 0 — bare loop
const agent = createAgent({ model: new FakeModelProvider([...]) });

// Layer 1 — add tools
const agent = createAgent({
  model: provider,
  tools: [readFileTool, runShellTool],
  permissions: new AlwaysAllowPolicy(),  // from @vole/permissions
});

// Layer 2 — add explicit permission policy with approval
const agent = createAgent({
  model: provider,
  tools: [readFileTool, runShellTool],
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: myResolver,
});

// Layer 4 — rich context assembly
const agent = createAgent({
  model: provider,
  context: new DefaultContextAssembler({ workspaceFiles: ["AGENTS.md"] }),
  systemInstruction: mySystemPrompt,
});

// Full — all layers
const agent = createAgent({
  model: provider,
  systemInstruction: AGENT_SYSTEM_INSTRUCTION,
  tools: allTools,
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: cliApprovalResolver,
  context: new DefaultContextAssembler({ workspaceFiles: [...] }),
  compaction: { maxTokens: 60_000 },
  maxSteps: 20,
});
```

`createAgent()` always returns an `AgentRuntime`. Sessions are not part of the factory — the caller passes `recentMessages` to each `runTurn()` call and persists the new messages from `turn_complete`.

Direct `new AgentRuntime(dependencies)` construction continues to work unchanged. `createAgent()` is the preferred API for all cases except those that require fine-grained control over the dependency object.

## 5. Minimal / Null Implementations

Each optional module has a minimal implementation that satisfies the interface with zero side effects. Use these to isolate the layer under test and to validate that layers are cleanly separable.

| Module | Full Implementation | Minimal / Null |
|---|---|---|
| `ModelProvider` | `AnthropicProvider`, `OpenAICompatibleProvider` | `FakeModelProvider` (scripted responses) |
| `ContextAssembler` | `DefaultContextAssembler` (XML sections, workspace files) | `MinimalContextAssembler` (pass-through) |
| `PermissionPolicy` | `DefaultPermissionPolicy` (risk × mode matrix) | `AlwaysAllowPolicy` (allow all non-blocked) |
| `ExecutableTool[]` | Full built-in tool set | `[]` (empty — no tool calls possible) |
| `SessionStore` | `JsonlSessionStore` | `InMemorySessionStore` (no file I/O) |
| `ApprovalResolver` | CLI readline prompt | *(omit — "ask" decisions auto-deny)* |

### MinimalContextAssembler

Does not read workspace files. Does not apply XML section formatting. Produces a system message from `systemInstruction` (if provided) and appends `recentMessages` + `userMessage` directly.

Use when: testing the agent loop, tool dispatch, or permission logic without needing to verify context assembly behavior.

### AlwaysAllowPolicy

Returns `allow` for every non-blocked tool action, regardless of risk level and autonomy mode. Still respects `"blocked"` risk level — blocked tools are always denied.

Use when: Layer 1 tests that need tool calls to execute without configuring an `ApprovalResolver`. Also useful in sandboxed evaluation environments where all tools are considered safe by definition.

## 6. Testing at Each Layer

Layer tests follow a pattern: use `FakeModelProvider` to control model output, inject the minimal implementation for every layer not under test, assert on emitted `RuntimeEvent` types.

```ts
// Layer 0 — verify the loop runs and emits run_completed
const agent = createAgent({
  model: new FakeModelProvider([{ type: "message", content: "ok" }])
});
const events = await collect(agent.runTurn({ message: "hi", recentMessages: [] }));
expect(events.at(-1)?.type).toBe("run_completed");

// Layer 1 — verify tool dispatch and result injection
const agent = createAgent({
  model: new FakeModelProvider([
    { type: "tool_calls", calls: [{ id: "c1", name: "echo", input: { text: "hello" } }] },
    { type: "message", content: "done" }
  ]),
  tools: [echoTool],
  permissions: new AlwaysAllowPolicy()
});
const events = await collect(agent.runTurn({ message: "echo hello", recentMessages: [] }));
expect(events.some(e => e.type === "tool_completed")).toBe(true);

// Layer 2 — verify permission evaluation fires before execution
const agent = createAgent({
  model: new FakeModelProvider([
    { type: "tool_calls", calls: [{ id: "c1", name: "run_shell", input: { command: "ls" } }] }
  ]),
  tools: [shellTool],
  permissions: new DefaultPermissionPolicy()
  // no approvalResolver → "ask" decisions auto-deny
});
const events = await collect(agent.runTurn({ message: "ls", recentMessages: [] }));
expect(events.some(e => e.type === "tool_call_permission_evaluated")).toBe(true);
expect(events.some(e => e.type === "approval_requested")).toBe(true);
expect(events.some(e => e.type === "run_failed")).toBe(true);
```

The layer tests live in `packages/core/src/create-agent.test.ts`.

## 7. Acceptance Criteria

Progressive composition is correctly implemented when:

- `createAgent({ model })` compiles and runs a turn successfully with zero other dependencies.
- Each layer can be verified in isolation: removing one module does not break tests for other layers.
- `AlwaysAllowPolicy` allows low, medium, and high-risk tool calls; denies blocked.
- `MinimalContextAssembler` produces a valid `ContextAssemblyResult` without reading any files.
- `AgentRuntime` direct construction still works unchanged for callers that require explicit wiring.
- Removing a module (by omitting it from `createAgent()`) is equivalent to replacing it with the null implementation — the system still runs.

## 8. Related Documents

- [Architecture Contracts](./contracts.md)
- [Runtime Composition](./runtime-composition.md)
- [Agent Loop](./agent-loop.md)
- [Permission System](./permission-system.md)
- [Context Engine](./context-engine.md)

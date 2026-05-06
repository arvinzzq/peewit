# Hooks System

Status: Design
Date: 2026-05-05

Simplified Chinese version: [hooks.zh-CN.md](./hooks.zh-CN.md)

## 1. Purpose

The hooks system provides extensibility points that let external code observe and react to agent lifecycle events without modifying the core runtime.

Without hooks, observability and customization require forking `AgentRuntime` or adding special-case logic inside the core loop. That makes the core harder to maintain and limits what users can do without code changes.

Hooks let integrators and power users:

- Log every tool call to an external system
- Flush memory after each turn
- Collect telemetry without polluting the agent loop
- Enforce custom policies at well-defined decision points
- Inject custom behavior at specific lifecycle moments

The core rule:

Hooks observe and react. They do not drive or block the agent loop. Hook errors are logged but never crash a run.

## 2. Hook Types

Peewit defines five hook types aligned with the agent lifecycle:

| Hook | Fires When | Receives |
| --- | --- | --- |
| `beforeTurn` | Before the model is called for a turn | `{ sessionId, runId, messages }` |
| `afterTurn` | After the model response is received | `{ sessionId, runId, response, toolCalls }` |
| `beforeToolCall` | Before any tool executes | `{ sessionId, runId, toolName, input }` |
| `afterToolCall` | After a tool returns its result | `{ sessionId, runId, toolName, input, result }` |
| `onCompaction` | After context compaction runs | `{ sessionId, runId, originalCount, compactedCount }` |

Each hook receives a read-only snapshot of the relevant state. Hooks cannot mutate agent state directly.

## 3. AgentHooks Interface

```typescript
interface AgentHooks {
  beforeTurn?: (ctx: BeforeTurnContext) => Promise<void> | void;
  afterTurn?: (ctx: AfterTurnContext) => Promise<void> | void;
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<void> | void;
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<void> | void;
  onCompaction?: (ctx: OnCompactionContext) => Promise<void> | void;
}

interface BeforeTurnContext {
  sessionId: string;
  runId: string;
  messages: readonly Message[];
}

interface AfterTurnContext {
  sessionId: string;
  runId: string;
  response: ModelResponse;
  toolCalls: readonly ToolCall[];
}

interface BeforeToolCallContext {
  sessionId: string;
  runId: string;
  toolName: string;
  input: unknown;
}

interface AfterToolCallContext {
  sessionId: string;
  runId: string;
  toolName: string;
  input: unknown;
  result: ToolResult;
}

interface OnCompactionContext {
  sessionId: string;
  runId: string;
  originalCount: number;
  compactedCount: number;
}
```

`AgentHooks` is passed to `AgentRuntime` at construction time. All fields are optional; unregistered hooks are simply not called.

## 4. Hook Execution

Hooks are called sequentially in registration order. If multiple hooks of the same type are registered (via an array or middleware pattern), they are awaited one after another.

Error isolation rule:

If a hook throws or rejects, the error is caught, logged as a `hook_error` trace event, and execution continues. Hook errors never propagate to the agent loop and never fail a run.

```typescript
async function runHooks(hooks: AgentHooks, event: 'beforeTurn', ctx: BeforeTurnContext): Promise<void> {
  if (!hooks.beforeTurn) return;
  try {
    await hooks.beforeTurn(ctx);
  } catch (err) {
    traceHookError('beforeTurn', err);
  }
}
```

Hooks that perform I/O should handle their own timeouts. The agent loop does not impose a hook timeout in the initial implementation.

## 5. Use Cases

### Telemetry and Logging

```typescript
const hooks: AgentHooks = {
  afterTurn: async ({ sessionId, runId, toolCalls }) => {
    await telemetry.record({ sessionId, runId, toolCount: toolCalls.length });
  },
};
```

### Custom Memory Flush

```typescript
const hooks: AgentHooks = {
  afterTurn: async ({ sessionId }) => {
    await memoryStore.flush(sessionId);
  },
};
```

### Policy Enforcement (Observational)

```typescript
const hooks: AgentHooks = {
  beforeToolCall: async ({ toolName, input }) => {
    auditLog.append({ toolName, input, timestamp: Date.now() });
  },
};
```

### Compaction Monitoring

```typescript
const hooks: AgentHooks = {
  onCompaction: async ({ originalCount, compactedCount }) => {
    metrics.gauge('context.compaction.ratio', compactedCount / originalCount);
  },
};
```

## 6. OpenClaw Alignment

OpenClaw implements hooks as injection points at turn boundaries and tool call boundaries. Key alignments:

| OpenClaw concept | Peewit equivalent |
| --- | --- |
| Pre-turn injection | `beforeTurn` hook |
| Post-turn injection | `afterTurn` hook |
| Pre-tool injection | `beforeToolCall` hook |
| Post-tool injection | `afterToolCall` hook |
| Error isolation | Hook errors logged, never propagated |

OpenClaw's hooks are used for memory consolidation triggers, channel-specific logging, and policy audit trails. Peewit adopts the same pattern with explicit TypeScript interfaces.

## 7. Acceptance Criteria

The hooks system is considered complete when:

- All five hook types fire at the correct lifecycle points.
- Hook errors are caught and logged as `hook_error` trace events without stopping the run.
- All hook context objects are read-only snapshots (no mutation of agent state).
- `AgentHooks` is configurable at `AgentRuntime` construction.
- Unit tests cover: each hook type fires, error isolation, no mutation side effects.

## 8. Related Documents

- [Agent Loop](./agent-loop.md)
- [Context Compaction](./context-compaction.md)
- [Execution Trace](./execution-trace.md)
- [Tool System](./tool-system.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Roadmap](../roadmap/overview.md)

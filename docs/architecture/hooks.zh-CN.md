# Hooks 系统

状态：设计
日期：2026-05-11

English version: [hooks.md](./hooks.md)

## 1. 目的

Hooks 系统提供扩展点，让外部代码能够观察并响应 agent 生命周期事件，而无需修改核心 runtime。

没有 hooks，可观察性和自定义需要 fork `AgentRuntime` 或在核心循环内添加特殊逻辑。这会让核心更难维护，并限制用户在不修改代码的情况下能做的事情。

Hooks 让集成者和高级用户能够：

- 将每次 tool 调用记录到外部系统
- 在每个 turn 后刷新 memory
- 不污染 agent loop 地收集遥测数据
- 在明确定义的决策点执行自定义策略
- 在特定生命周期时刻注入自定义行为

核心规则：

Hooks 观察和响应，不驱动或阻塞 agent loop。Hook 错误会被记录，但绝不会崩溃运行。

## 2. Hook 类型

Vole 定义了与 agent 生命周期对齐的五种 hook 类型：

| Hook | 触发时机 | 接收参数 |
| --- | --- | --- |
| `beforeTurn` | 在 turn 调用模型之前 | `{ sessionId, runId, messages }` |
| `afterTurn` | 在收到模型响应之后 | `{ sessionId, runId, response, toolCalls }` |
| `beforeToolCall` | 在任何 tool 执行之前 | `{ sessionId, runId, toolName, input }` |
| `afterToolCall` | 在 tool 返回结果之后 | `{ sessionId, runId, toolName, input, result }` |
| `onCompaction` | 在 context compaction 运行之后 | `{ sessionId, runId, originalCount, compactedCount }` |

每个 hook 接收相关状态的只读快照。Hooks 不能直接修改 agent 状态。

## 3. AgentHooks 接口

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

`AgentHooks` 在构建时传递给 `AgentRuntime`。所有字段都是可选的；未注册的 hooks 简单地不被调用。

## 4. Hook 执行

Hooks 按注册顺序依次调用。如果同一类型注册了多个 hooks（通过数组或中间件模式），它们会逐一被 await。

错误隔离规则：

如果 hook 抛出异常或 reject，错误会被捕获，作为 `hook_error` trace 事件记录，然后继续执行。Hook 错误不会传播到 agent loop，也不会导致运行失败。

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

执行 I/O 的 hooks 应自行处理超时。初始实现中，agent loop 不对 hook 施加超时限制。

## 5. 使用场景

### 遥测和日志记录

```typescript
const hooks: AgentHooks = {
  afterTurn: async ({ sessionId, runId, toolCalls }) => {
    await telemetry.record({ sessionId, runId, toolCount: toolCalls.length });
  },
};
```

### 自定义 Memory 刷新

```typescript
const hooks: AgentHooks = {
  afterTurn: async ({ sessionId }) => {
    await memoryStore.flush(sessionId);
  },
};
```

### 策略执行（观察型）

```typescript
const hooks: AgentHooks = {
  beforeToolCall: async ({ toolName, input }) => {
    auditLog.append({ toolName, input, timestamp: Date.now() });
  },
};
```

### Compaction 监控

```typescript
const hooks: AgentHooks = {
  onCompaction: async ({ originalCount, compactedCount }) => {
    metrics.gauge('context.compaction.ratio', compactedCount / originalCount);
  },
};
```

## 6. OpenClaw 对齐

OpenClaw 在 turn 边界和 tool 调用边界实现 hooks 作为注入点。关键对齐：

| OpenClaw 概念 | Vole 等效 |
| --- | --- |
| Pre-turn injection | `beforeTurn` hook |
| Post-turn injection | `afterTurn` hook |
| Pre-tool injection | `beforeToolCall` hook |
| Post-tool injection | `afterToolCall` hook |
| 错误隔离 | Hook 错误被记录，不传播 |

OpenClaw 的 hooks 用于 memory 整合触发、channel 特定日志记录和策略审计跟踪。Vole 采用相同模式，提供明确的 TypeScript 接口。

## 7. 验收标准

Hooks 系统在满足以下条件时视为完成：

- 所有五种 hook 类型在正确的生命周期点触发。
- Hook 错误被捕获并作为 `hook_error` trace 事件记录，不停止运行。
- 所有 hook context 对象都是只读快照（不修改 agent 状态）。
- `AgentHooks` 可在 `AgentRuntime` 构建时配置。
- 单元测试覆盖：每种 hook 类型触发、错误隔离、无副作用修改。

## 8. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [Context Compaction](./context-compaction.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

# Architecture Contracts

状态：草案
日期：2026-05-02

English version: [contracts.md](./contracts.md)

## 1. 目的

本文档记录 Peewit 模块之间第一版 architecture-level contracts。

这些 contracts 不是最终 TypeScript APIs。它们是用于指导实现和测试的设计约束。

核心规则：

Contracts 应让模块可替换、可测试。

## 2. Contract 原则

Peewit contracts 应该是：

- Adapter-agnostic
- Provider-agnostic
- Tool-safe
- Trace-visible
- 可用 fake implementations 测试
- 足够小，能在 MVP 阶段演进

第一版实现可以调整名称和形状，但应保留职责边界。

## 3. Agent Runtime

`AgentRuntime` 拥有一次 user turn 或 goal execution。

概念契约：

```ts
interface AgentRuntime {
  runTurn(input: UserTurnInput): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
}
```

它接收 user input，并发出 structured events。

它不能拥有 terminal rendering、HTTP rendering 或 provider setup。

## 4. Runtime Events

Runtime events 是 Agent Core 和 adapters 之间的桥梁。

概念 events：

```ts
type RuntimeEvent =
  | AssistantMessageEvent
  | TraceEvent
  | ApprovalRequestEvent
  | RunCompletedEvent
  | RunFailedEvent;
```

Adapters 可以用不同方式渲染这些 events，但不应该重新解释 agent behavior。

## 5. Model Provider

`ModelProvider` 归一化 model vendor behavior。

概念契约：

```ts
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
}
```

Provider 返回 assistant text、tool calls 或 normalized error。

## 6. Context Assembler

`ContextAssembler` 从安全 sources 创建 model input。

概念契约：

```ts
interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>;
}
```

它拥有 prompt assembly、source ordering、truncation、redaction 和 context reports。

CLI 和 Web UI 不能直接 assemble prompts。

## 7. Tool Registry

`ToolRegistry` 描述并解析 tools。

概念契约：

```ts
interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): Tool | undefined;
}
```

Tool inputs 在验证前都是不可信的。

## 8. Tool

一个 tool 执行一种外部能力。

概念契约：

```ts
interface Tool {
  definition: ToolDefinition;
  validate(input: unknown): ToolValidationResult;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}
```

Tools 不决定某个动作是否允许。Permissions 拥有该决策。

## 9. Permission Policy

`PermissionPolicy` 在执行前分类 actions。

概念契约：

```ts
interface PermissionPolicy {
  evaluate(action: ToolAction, context: PermissionContext): PermissionDecision;
}
```

Policy 返回 allow、ask 或 deny。需要时由 adapter 询问用户。

## 10. Session Store

`SessionStore` 持久化 conversation 和 run records。

概念契约：

```ts
interface SessionStore {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  appendTurn(sessionId: string, turn: SessionTurn): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
}
```

MVP 可以使用轻量本地实现，但调用方应依赖接口。

## 11. Trace Sink

`TraceSink` 记录 structured trace events。

概念契约：

```ts
interface TraceSink {
  append(event: TraceEvent): Promise<void>;
  list(query: TraceQuery): Promise<TraceEvent[]>;
}
```

Trace events 在 display 前必须 redacted；可行时，持久化前也要 redacted。

## 12. Config Loader

`ConfigLoader` 生成 effective configuration。

概念契约：

```ts
interface ConfigLoader {
  load(input: ConfigLoadInput): Promise<EffectiveConfig>;
  redacted(config: EffectiveConfig): RedactedConfigView;
}
```

Agent Core 应接收 configured dependencies，而不是 config loader 本身。

## 13. Approval Adapter Boundary

Approval UX 属于 adapters。

概念契约：

```ts
interface ApprovalResponder {
  respond(requestId: string, decision: ApprovalDecision): Promise<void>;
}
```

Permission package 决定需要 approval。CLI 或 Web UI 收集用户 decision。

## 14. 测试要求

Contracts 应被测试保护。

必需测试领域：

- Fake implementations 可以满足每个 contract。
- AgentRuntime 可以与 fake provider、fake tools、fake permission policy 和 fake trace sink 一起工作。
- Provider output normalization 匹配 tool registry expectations。
- Permission decisions 在 trace 中可见。
- ContextAssembler output 可以发送给 ModelProvider，且不包含 adapter-specific data。
- CLI adapter 只消费 RuntimeEvents 和 approval requests。

## 15. 验收标准

Architecture contracts 成功标准：

- 每个主要模块都有清晰边界。
- Core contracts 足够小，可以支持 MVP implementation。
- Contracts 支持 fake implementations，用于测试。
- Adapter、provider、tool、permission、context、session 和 trace 职责被分离。
- 未来 Web UI 可以复用同一 runtime contracts。

## 16. 相关文档

- [Runtime Composition](./runtime-composition.zh-CN.md)
- [Testing Strategy](./testing-strategy.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [CLI Adapter](./cli-adapter.zh-CN.md)
- [Model Provider](./model-provider.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)

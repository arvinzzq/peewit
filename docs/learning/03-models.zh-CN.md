# 模块 02：@vole/models

Status: Complete
Date: 2026-05-07

English version: `03-models.md`

相关源码：`packages/models/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md)阶段三（基础层模块）的一部分。在阅读本文档之前，
先读 [02-core.zh-CN.md](./02-core.zh-CN.md)，这样你已经知道 `ModelProvider` 在循环中
的哪个位置被调用。

**阅读前**：把 `packages/models/src/index.ts` 从头到尾快速扫一遍，只看导出了什么。
然后阅读本文档了解设计决策。

**核心问题**：
- 为什么 `ModelProvider` 只有一个方法？
- 为什么 `ModelErrorOutput` 是 `ModelOutput` 的一部分，而不是抛出异常？
- `FakeModelProvider` 如何让测试不需要真实 API 调用？
- 为什么 Anthropic 消息格式翻译在 provider 内部，而不是在 core 里？

**检查点**：当你能解释 core 从 `ModelProvider` 收到什么、以及为什么它永远不需要知道
使用的是哪家厂商，说明你已经掌握了这个模块。

## 1. 这个模块做什么

`@vole/models` 把所有厂商特定的模型 API 封装在统一的 `ModelProvider` 接口后面。它把
内部的 `ModelMessage[]` 格式翻译成各厂商的线路格式，调用 API，再把响应归一化回
`ModelOutput`。

它是代码库里唯一会引入厂商 SDK（`@anthropic-ai/sdk`）或向模型 API 发起 HTTP 请求的包。

## 2. 为什么它存在

如果 `@vole/core` 直接调用 Anthropic SDK，那么：
- 换模型需要修改循环逻辑
- 测试循环需要真实 API 调用或复杂的 mock
- 添加新 provider 需要改动 core 逻辑

`@vole/models` 创造了一个硬分界：core 依赖接口（`ModelProvider`），而不依赖任何具体厂商。
厂商细节——API 格式、认证头、流式协议、错误码——完全封装在这个包里。

## 3. 公开接口

```ts
// 核心契约：一个方法，一个输入，一个输出
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>
}

// 可选的流式扩展——继承 ModelProvider
interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>
}

// 任何模型调用的三种可能结果
type ModelOutput =
  | { type: "message"; content: string; usage?: ModelUsage }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean }

// 内部消息格式——所有 provider 共用
interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCallId?: string        // 存在于工具结果消息中
  toolCalls?: ModelToolCall[] // 存在于调用了工具的 assistant 消息中
}

// 具体 provider 实现
class AnthropicProvider implements StreamingModelProvider { ... }
class OpenAICompatibleProvider implements StreamingModelProvider { ... }

// 测试替身
class FakeModelProvider implements ModelProvider { ... }
class FakeStreamingProvider implements StreamingModelProvider { ... }
```

`isStreamingProvider()` 类型守卫让 core 可以在运行时检查一个 provider 是否支持流式，
无需要求特定的基类继承关系。

## 4. 实现流程

每个 provider 遵循同样的三步路径：

**第一步 — 翻译输入**
把 `ModelMessage[]` 从内部格式转换成厂商线路格式。
对于 `AnthropicProvider`：`translateMessagesToAnthropic()` 处理结构差异：
- 连续的 `tool` 消息合并成一条带有多个 `tool_result` content block 的 `user` 消息
- 带有工具调用的 `assistant` 消息变成 `tool_use` 类型的 content block

对于 `OpenAICompatibleProvider`：内部格式与 OpenAI 格式比较接近，翻译相对简单。

**第二步 — 调用 API**
`AnthropicProvider.generate()` 调用 `this.#client.messages.create()`。
`OpenAICompatibleProvider.generate()` 向配置的 base URL 发起 `fetch()` 请求。

两者都不使用 `throw` 处理错误：网络失败和 API 错误都返回 `{ type: "error", ... }` 值。

**第三步 — 归一化输出**
厂商响应被映射到三种 `ModelOutput` 形状之一：
- `stop_reason === "tool_use"` → `{ type: "tool_calls" }`
- 文本内容 → `{ type: "message" }`
- 任何失败 → `{ type: "error", recoverable: boolean }`

流式路径遵循同样的结构，但使用 `AsyncIterable<StreamEvent>` 逐 token yield
`token_delta` 事件，流结束时发出 `message_done` 或 `tool_calls` 最终事件。

## 5. OpenClaw 对照

| OpenClaw | Vole | 备注 |
|---|---|---|
| 模型 provider 抽象层 | `ModelProvider` / `StreamingModelProvider` | 相同模式 |
| provider 中立消息格式 | `ModelMessage[]` | OpenClaw 也使用内部格式 |
| 用于测试的 fake provider | `FakeModelProvider`、`FakeStreamingProvider` | 标准测试替身模式 |

`ThinkingBudget`（`off` / `adaptive` / `minimal` … `max`）与 OpenClaw 文档中的思考预算
级别对齐，Vole 在后续阶段推迟了配置界面。Provider 层已经支持该功能。

## 6. 关键设计决策

**错误作为值返回，不抛出异常**

`ModelErrorOutput` 是 `ModelOutput` 的成员，而不是被抛出的异常。Core 用
`if (output.type === "error")` 处理它，而不是 `try/catch`。这让错误路径明确且可组合——
调用方始终知道它必须处理三种输出类型。

`recoverable: boolean` 内嵌在错误里。`rate_limit` 和 `network` 错误是可恢复的（重试有
意义）。`invalid_request` 和 `authentication` 错误不可恢复（重试只会得到同样结果）。
Core 可以用这个标记决定是否上报错误或尝试恢复。

**流式是可选扩展**

`StreamingModelProvider extends ModelProvider`。只实现了 `generate()` 的 provider 仍然
是有效的 `ModelProvider`。Core 通过鸭子类型 `isStreamingProvider()` 在运行时检查——
`"generateStream" in provider`——而不是要求特定基类继承。这避免了钻石继承问题，并保持
provider 的松耦合。

**消息翻译在 provider 里，不在 core 里**

Anthropic 和 OpenAI 的消息 schema 根本不同。把 `translateMessagesToAnthropic()` 放在
`AnthropicProvider` 内部意味着 core 永远不接触厂商特定的结构。如果 Anthropic 改了 API，
只需改 `AnthropicProvider`。

**`FakeModelProvider` 记录请求**

```ts
class FakeModelProvider {
  readonly requests: ModelInput[] = []  // 公开可读，供测试断言
}
```

`requests` 是公开的，让测试可以断言*发送给模型的内容*，而不只是收到了什么。
「第二次调用时 context 里是否包含工具结果？」——直接断言 `provider.requests[1].messages`。

## 7. 测试方式

测试在 `packages/models/src/index.test.ts`。测试套件里没有任何真实 API 调用——所有网络
交互通过可注入的 `fetch`（用于 `OpenAICompatibleProvider`）和可注入的 client 实例（用于
`AnthropicProvider`）来测试。

`FakeModelProvider` 使用队列模式：构造函数接受 `outputs: ModelOutput[]`，每次 `generate()`
调用从队列前端弹出一个输出。队列为空时返回不可恢复的错误。这让测试可以脚本化精确的
多轮对话：

```ts
new FakeModelProvider([
  { type: "tool_calls", calls: [{ name: "read_file", ... }] },
  { type: "message", content: "这是摘要。" }
])
```

测试类别：
- `ModelProvider` 接口契约（generate 返回正确的输出类型）
- 消息格式翻译（系统消息、工具调用、工具结果）
- 错误归一化（HTTP 401 → `authentication`，429 → `rate_limit`）
- 流式路径（token delta、工具调用累积、SSE 解析）
- `FakeModelProvider` 队列耗尽行为

## 8. 关键洞察

**`ModelOutput` 作为判别联合强制穷举处理。** TypeScript 会在你添加了新的输出类型但
忘记在 core 的 `if/else` 链中处理时产生编译错误。联合类型是契约，类型检查器负责
强制执行。

**系统提示在 `AnthropicProvider.generate()` 中获得 `cache_control: ephemeral`。** 这告诉
Anthropic API 跨调用缓存系统提示内容。由于 Vole 的系统提示很长（工具、技能、权限指南），
每轮都重建，缓存避免了重复处理的成本。这对 core 和适配器完全透明。

**`isStreamingProvider()` 使用鸭子类型，不用 `instanceof`。** 当 provider 被包装或代理时
这很重要——`instanceof` 会对包装类失败，但鸭子类型检查实际能力。

**`OpenAICompatibleProvider` 可以对接任何 OpenAI 格式的端点。** `baseURL` 配置意味着它
可以指向 OpenRouter、本地 `ollama` 或任何其他 OpenAI 兼容的主机，同一个类服务所有这些。

## 9. 复习问题

1. 为什么 `ModelProvider` 只有一个方法（`generate`）？它明确排除了什么职责？
   > 它只承诺：给定消息，返回模型输出。排除了会话管理、流式协议细节、错误重试逻辑和
   > 厂商认证。所有这些要么在 provider 实现内部处理，要么在调用方（core）处理。

2. 三种 `ModelOutput` 变体是什么，core 对每种怎么处理？
   > `message` → 发射 `assistant_message_created`，结束本轮。
   > `tool_calls` → 对每个调用评估权限并执行。
   > `error` → 立即发射 `run_failed`；如果 `recoverable: true`，理论上可以重试
   > （但 core 目前对模型错误总是终止运行）。

3. 为什么 `ModelErrorOutput` 使用 `recoverable: boolean` 而不是只有错误类型？
   > 因为可恢复性取决于错误类型和上下文。把 `recoverable` 内嵌在输出中意味着
   > provider——它了解这个错误——做出判断。调用方不需要把错误类别映射到恢复决策。

4. 为什么 Anthropic 消息翻译在 `AnthropicProvider` 内部而不是在 core 里？
   > Core 使用单一的内部 `ModelMessage[]` 格式。如果翻译在 core 里，core 就需要知道
   > 每个厂商的线路格式。把它移到 provider 隔离了变更范围：新增厂商 = 新建 provider
   > 类，core 不变。

5. `FakeModelProvider` 如何在不调用真实 API 的情况下实现多步对话测试？
   > 构造函数接受一个 `ModelOutput` 队列，每次 `generate()` 弹出一个。测试脚本化
   > 精确的对话序列。`requests` 记录每次收到的 `ModelInput`，让测试也能断言每步发送给
   > 模型的 context 内容。

6. `StreamingModelProvider extends ModelProvider` 对只实现了 `generate()` 的 provider 意味着什么？
   > 它仍然是有效的 `ModelProvider`，可以在任何需要 `ModelProvider` 的地方使用。
   > Core 只在 `isStreamingProvider()` 返回 `true` 且 `preferStreaming` 启用时才激活
   > 流式路径。非流式 provider 会优雅降级。

7. 系统提示上的 `cache_control: { type: "ephemeral" }` 是什么，为什么只出现在 `AnthropicProvider` 里？
   > 这是 Anthropic 特定的提示缓存功能：系统提示内容在服务端缓存，在重复调用时
   > 不重新处理。只出现在 `AnthropicProvider` 是因为它是厂商特定功能——core 和
   > context assembly 对此毫无感知。

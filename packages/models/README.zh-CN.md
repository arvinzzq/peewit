# Models Package

English version: [README.md](./README.md)

## 架构概述

`@arvinclaw/models` 定义 **Provider 无关的模型契约**，并在其背后实现具体的 Provider。所有需要调用 LLM 的包都只依赖 `ModelProvider` 接口——绝不直接依赖 vendor SDK。

```
@arvinclaw/core
    │  使用
    ▼
ModelProvider（接口）
    │  实现者
    ├─ OpenAICompatibleProvider  （基于 fetch，支持 SSE 流式）
    ├─ AnthropicProvider         （Anthropic SDK，支持可注入客户端）
    └─ FakeModelProvider         （测试替身）
```

models 是唯一导入 `@anthropic-ai/sdk` 的包。所有 vendor 特定的消息格式、stop reason、工具调用结构和错误码都在此处归一化，永不向上泄漏。

## 核心概念

### ModelProvider / StreamingModelProvider

`ModelProvider` 只有一个方法：`generate(input: ModelInput): Promise<ModelOutput>`。

`StreamingModelProvider` 在此基础上扩展 `generateStream(input: ModelInput): AsyncIterable<StreamEvent>`。

`isStreamingProvider(provider)` 是运行时类型守卫，核心运行时用它根据 `preferStreaming` 决定调用哪个方法。

### ModelInput / ModelOutput

`ModelInput` 是标准请求格式，包含 `messages`（system/user/assistant/tool 角色）、可选的 `tools`（JSON schema 函数定义）和可选的 `options`（model、temperature、maxTokens 覆盖）。

`ModelOutput` 是含三种变体的判别联合类型：

| type | 触发时机 | 包含内容 |
|---|---|---|
| `"message"` | 模型返回纯文本 | `content: string`，可选 `usage` |
| `"tool_calls"` | 模型请求工具调用 | `calls: ModelToolCall[]`，可选 `usage` |
| `"error"` | 请求失败 | `category`、`message`、`recoverable: boolean` |

错误类别（`authentication`、`rate_limit`、`network`、`invalid_request`、`model_unavailable`、`context_length`、`unknown`）允许调用者做出明智的重试决策。

### StreamEvent

`generateStream` yield 的流事件：`token_delta`（文本 token 到达）、`message_done`（流以文本完成）、`tool_calls`（流以工具调用完成）、`error`（流失败）。

运行时累积 `token_delta` 事件（立即 yield 给 Adapter 用于实时显示），并将终止事件转换回 `ModelOutput` 兼容形式。

## 实现原理

### OpenAICompatibleProvider

使用可注入的 `fetch` API 调用任何 OpenAI 兼容的 `/chat/completions` 端点。

**非流式路径**：POST JSON，解析 `choices[0]`，映射 `finish_reason: "tool_calls"` 或文本消息。

**流式路径**：添加 `stream: true`，通过 `parseSSEStream` 解析 Server-Sent Events。工具调用参数通过 `Map<index, accumulator>` 跨多个 delta 块累积，流结束时解析。

### AnthropicProvider

使用 `@anthropic-ai/sdk`，支持两个独立的可注入客户端：

- `AnthropicClientLike` — 非流式 `messages.create()`。
- `AnthropicStreamClientLike` — 流式 `messages.stream()`。

**消息翻译** (`translateMessagesToAnthropic`)：
- `system` 角色 → 提取为独立 `system` 数组，附带 `cache_control: { type: "ephemeral" }`（启用提示缓存）。
- 连续的 `tool` 角色消息 → 合并为单个 `user` 消息，内容为 `tool_result` 块。
- 含 `toolCalls` 的 `assistant` → 转为包含 `text` + `tool_use` 混合内容块的 `assistant`。

**流式路径**：处理原始流事件，文本 delta 作为 `token_delta` yield，工具输入 JSON 按块 index 增量累积，流结束时解析。

**降级**：若 `streamClient` 不可用，`generateStream` 回退到 `generate` 并包装为单事件流。

### ThinkingBudget

将可读的预算级别映射到 Anthropic 扩展思考 API 参数：

| 预算 | API 参数 |
|---|---|
| `"off"` / undefined | 无 `thinking` 字段 |
| `"adaptive"` | `{ type: "adaptive" }` |
| `"minimal"` | `budget_tokens: 1024` |
| `"low"` | `budget_tokens: 2048` |
| `"medium"` | `budget_tokens: 4096` |
| `"high"` | `budget_tokens: 8192` |
| `"max"` | `budget_tokens: 16384` |

### FakeModelProvider / FakeStreamingProvider

预加载输出队列的测试替身，将所有 `generate` 输入记录到公共 `requests` 数组，供测试断言发送给模型的内容。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明公共包导出和构建脚本，依赖 `@anthropic-ai/sdk`。 |
| `tsconfig.json` | TypeScript 配置 | 构建 models 包。 |
| `src/index.ts` | Provider 层 | 所有导出：`ModelProvider`、`StreamingModelProvider`、`isStreamingProvider`、`ModelInput/Output/Message/ToolDefinition`、`StreamEvent`、`OpenAICompatibleProvider`、`AnthropicProvider`、`AnthropicProviderConfig`、`ThinkingBudget`、`FakeModelProvider`、`FakeStreamingProvider`。 |
| `src/index.test.ts` | Provider 测试 | 保护假 Provider 行为、流式检测、SSE 解析、Anthropic 消息翻译、工具调用累积、thinking budget 映射和错误类别归一化。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

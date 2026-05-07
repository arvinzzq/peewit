# 0005：Anthropic Provider

状态：已接受
日期：2026-05-04

English version: [0005-anthropic-provider.md](./0005-anthropic-provider.md)

## 1. 背景

Vole 目前只支持 OpenAI-compatible provider。这通过 OpenRouter 等服务覆盖了大量 hosted models，对 MVP 来说已足够。

然而，Vole 的主要架构参考是 OpenClaw，而 OpenClaw 是基于 Anthropic 的 Claude 模型构建的。Anthropic 的 tool calling 格式（`tool_use` content blocks）与 OpenAI 的（message 中的 `tool_calls`）不同。两种格式实现相同的行为，但希望直接使用 Claude 的用户需要通过 OpenRouter 或其他代理来路由请求，而不能直接连接 Anthropic。

还有能力对齐的原因：Anthropic SDK 提供了 OpenClaw 使用、Vole 后续阶段会用到的功能，包括 prompt caching、extended thinking 和 streaming。

## 2. 决策

Vole 将在 Phase 3 添加 `AnthropicProvider`。

该决策同时保留两个 provider：

- `OpenAICompatibleProvider`：继续支持 OpenRouter、OpenAI 以及任何 OpenAI-compatible 端点。
- `AnthropicProvider`：直接集成 Anthropic SDK，用于 Claude 模型。

`ModelProvider` 接口已经能干净地支持多种实现。添加 `AnthropicProvider` 不需要更改 Agent Core、工具系统或权限系统。

## 3. Provider 选择

Provider 通过配置选择：

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseURL": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4.1-mini"
  }
}
```

或：

```json
{
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-7"
  }
}
```

密钥通过环境变量提供：

```text
VOLE_API_KEY        用于 openai-compatible
OPENROUTER_API_KEY       OpenRouter 快捷方式
ANTHROPIC_API_KEY        用于 anthropic
```

## 4. Anthropic Tool Call 格式

OpenAI 和 Anthropic 使用不同的 tool calling 格式，但 `ModelProvider` 将两者归一化为相同的 `ModelToolCallsOutput` 结构：

| 关注点 | OpenAI 格式 | Anthropic 格式 | 归一化结果 |
| --- | --- | --- | --- |
| 响应中的 tool call | `message.tool_calls[]` | `content[].type === "tool_use"` | `ModelToolCallsOutput.calls[]` |
| Tool 定义 | `{ type: "function", function: { name, description, parameters } }` | `{ name, description, input_schema }` | `ModelToolDefinition` → 各 provider 自行转换 |
| Tool result | `{ role: "tool", tool_call_id, content }` | `{ type: "tool_result", tool_use_id, content }` | `ModelMessage.role === "tool"` → 各 provider 自行格式化 |

`AnthropicProvider` 负责 `ModelInput` / `ModelOutput` 结构与 Anthropic API 格式之间的转换。Agent Core 不知道哪个 provider 处于激活状态。

## 5. Streaming

初始的 `AnthropicProvider` 实现不需要支持 streaming。非流式响应对 Phase 3 功能已足够。

Streaming 支持应在 Phase 6（Web UI 需要实时 token 显示时）设计并添加。届时 `ModelProvider` 可能会增加一个可选的 `stream()` 方法，或者 `generate()` 返回 `AsyncIterable`。

## 6. 影响

正面：

- Vole 用户可以直接使用 Claude，无需代理。
- Vole 与 OpenClaw 的主要模型家族更好地对齐。
- Anthropic SDK 能力（caching、thinking）在后续阶段可用。
- `ModelProvider` 接口通过两个真实实现得到验证。

权衡：

- 添加 `@anthropic-ai/sdk` 依赖。
- Anthropic 消息格式更复杂（content blocks vs 简单字符串）。
- 需要维护两个 provider 实现。

## 7. 不变的部分

- Agent Core 循环。
- 工具系统。
- 权限系统。
- Session 存储。
- Context assembly 概念。
- CLI adapter 行为。

## 8. 相关文档

- [Model Provider](../architecture/model-provider.md)
- [Reference Systems](../architecture/reference-systems.md)
- [Phase 3 Plan](../plans/phase-3-context-assembly-and-skills.md)
- [Main Design](../product/vole-design.md)

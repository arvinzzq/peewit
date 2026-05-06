# Model Provider

状态：草案
日期：2026-05-02

English version: [model-provider.md](./model-provider.md)

## 1. 目的

Model Provider 层用于隔离 Agent Core 与具体 LLM 厂商和 SDK。

Peewit 应该可以先接入一个 OpenAI-compatible provider，后续再支持 Anthropic、Gemini、Ollama、本地模型或其他托管模型，而不需要重写 Agent Loop。

核心规则：

Agent Core 依赖稳定的 `ModelProvider` 接口，而不是厂商 SDK。

## 2. 为什么需要这一层

不同模型厂商在很多方面不同：

- API 认证
- 消息格式
- 工具调用格式
- 流式输出行为
- token 用量报告
- 错误类型
- 限流处理
- 模型能力 metadata

如果 Agent Core 直接调用某家 API，厂商细节会泄漏到规划、工具执行、轨迹和配置里。Provider 层把这些差异关在边界内。

## 3. MVP Provider

MVP 实现一个 provider：

```text
OpenAICompatibleProvider
```

该 provider 支持足够接近 OpenAI 风格 chat completions 或 responses 语义的 API，并通过以下配置接入：

- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `maxTokens`

这样 MVP 可以实际接入 OpenAI-compatible 托管模型或本地 gateway，同时保持实现简单。

## 4. 职责

Model Provider 层负责：

- 把 Peewit 的模型输入转换成 provider 请求格式
- 把 provider 输出转换成 Peewit 模型输出
- 归一化工具调用
- 归一化最终 assistant message
- 归一化 provider 错误
- 在可用时报告 usage metadata
- 为未来 streaming 预留能力

Model Provider 层不负责：

- Agent 规划
- 权限决策
- 工具执行
- Skill 加载
- Session 持久化
- CLI 渲染

## 5. 输入和输出

### 模型输入

Provider 输入：

- Messages
- 可用工具定义
- Model name
- Temperature
- Max token budget
- 可选 response format hints
- 可选 trace metadata

### 模型输出

Provider 输出：

- 最终 assistant 文本，或
- 模型请求的工具调用，或
- 可恢复 provider 错误

也可以包含：

- Token usage
- Finish reason
- Provider request ID
- Debug trace 模式下的原始 provider metadata

## 6. 工具调用

Agent Core 不应依赖某个厂商的原始工具调用格式。

Provider 应把工具请求归一化为内部结构，例如：

```ts
interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}
```

这样 Tool System 可以验证和执行调用，而不需要知道是哪家 LLM provider 生成了它。

## 7. Streaming

Phase 6 以可选扩展的形式在 `ModelProvider` 上添加了流式支持。

### 接口

```ts
export type StreamEvent =
  | { type: "token_delta"; delta: string }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage }
  | { type: "message_done"; content: string; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean };

export interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>;
}

export function isStreamingProvider(provider: ModelProvider): provider is StreamingModelProvider;
```

`StreamingModelProvider` 扩展了 `ModelProvider`，因此流式 Provider 可以直接替换非流式 Provider。非流式 Provider 继续正常工作。

### 事件序列

流式响应发出：

1. 零个或多个 `token_delta` 事件——每个携带一个文本片段。
2. `message_done`（文本响应完成）或 `tool_calls`（模型请求工具）之一。
3. 发生故障时可选发出 `error`。

### Agent Core 行为

`AgentRuntime` 使用 `isStreamingProvider()` 检测 Provider 是否实现了 `StreamingModelProvider`。若是：

- 调用 `generateStream()` 而非 `generate()`。
- 将每个 `token_delta` 转发为 `token_delta` 运行时事件。
- 在 `message_done` 或 `tool_calls` 到达前等待，再做工具派发决策。

流式是交付细节。Agent Loop 的决策节点（执行工具还是生成最终消息）保持不变。

### Provider 实现

- `OpenAICompatibleProvider` — 使用 `stream: true`，从 `response.body` 解析 SSE 数据块。
- `AnthropicProvider` — 使用 Anthropic SDK 流式接口，将 `content_block_delta` 转换为 `token_delta`。
- `FakeStreamingProvider` — 测试替身，发出可配置的 Token 序列。

## 8. 错误归一化

Provider-specific 错误应归一化为少量类别：

- Authentication error
- Rate limit error
- Network error
- Invalid request
- Model unavailable
- Context length exceeded
- Unknown provider error

这样 Agent Core 和 adapters 可以展示有用信息，而不需要匹配厂商异常类型。

## 9. 配置

模型配置来自合并后的有效配置：

- 项目配置：`peewit.config.json`
- 用户配置：`~/.peewit/config.json`
- 环境变量

示例：

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseURL": "https://api.example.com/v1",
    "model": "example-model",
    "temperature": 0.2,
    "maxTokens": 4096
  }
}
```

密钥不应存进项目配置。API key 应来自环境变量，例如：

```text
PEEWIT_API_KEY
OPENROUTER_API_KEY
```

未来可支持 provider-specific key：

```text
PEEWIT_OPENAI_API_KEY
PEEWIT_ANTHROPIC_API_KEY
PEEWIT_GEMINI_API_KEY
```

## 10. 能力 Metadata

不同模型支持的能力不同。Provider 层后续应暴露能力 metadata：

- 是否支持工具
- 是否支持 streaming
- 是否支持结构化输出
- 最大上下文长度
- 是否支持 vision input
- 是否支持 JSON mode

MVP 可以简单假设配置模型支持文本和工具调用。后续版本应显式化能力。

## 11. Provider 选择

Agent Core 应接收已经配置好的 provider 实例。它不应该知道如何读取环境变量或实例化厂商 client。

Provider setup 属于应用组装：

```text
CLI startup
  -> 加载配置
  -> 创建 provider
  -> 创建 tools
  -> 创建 permissions
  -> 创建 AgentRuntime
```

这样 runtime 逻辑和 app bootstrapping 分离。

## 12. 未来 Providers

可能的未来 provider：

- Anthropic provider
- Gemini provider
- Ollama provider
- 本地 OpenAI-compatible provider
- Router provider

Router provider 可支持：

- 失败 fallback
- 用便宜模型做规划
- 用更强模型做最终综合
- 隐私任务走本地模型
- 复杂推理走托管模型

## 13. 最小接口草案

```ts
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
}

interface ModelInput {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  options?: ModelRequestOptions;
}

type ModelOutput =
  | { type: "message"; content: string; usage?: ModelUsage; metadata?: unknown }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage; metadata?: unknown };
```

这些是说明性接口，不是最终实现契约。

## 14. 验收标准

MVP Model Provider 层成功标准：

- Agent Core 调用 `ModelProvider` 接口。
- OpenAI-compatible provider 可以发送消息并收到归一化响应。
- 工具调用归一化为 Peewit 内部结构。
- Provider 错误足够归一化，CLI 能解释。
- API key 从环境变量加载，不写入项目配置。
- 新 provider 可以在不改 Agent Core 主循环的情况下加入。

## 15. 相关文档

- [主设计](../product/peewit-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)

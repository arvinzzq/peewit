# 0005: Anthropic Provider

Status: Accepted
Date: 2026-05-04

Simplified Chinese version: [0005-anthropic-provider.zh-CN.md](./0005-anthropic-provider.zh-CN.md)

## 1. Context

ArvinClaw currently supports only an OpenAI-compatible provider. This covers a wide range of hosted models through services like OpenRouter, and it is sufficient for the MVP.

However, ArvinClaw's primary architecture reference is OpenClaw, and OpenClaw is built on Anthropic's Claude models. Anthropic's tool calling format (`tool_use` content blocks) differs from OpenAI's (`tool_calls` in the message object). Both formats achieve the same behavior, but a Claude-first user would need to configure ArvinClaw to route Claude calls through OpenRouter or another proxy rather than connecting directly to Anthropic.

There is also a capability alignment reason: Anthropic's SDK provides features that OpenClaw uses and that ArvinClaw will want in later phases, including prompt caching, extended thinking, and streaming.

## 2. Decision

ArvinClaw will add an `AnthropicProvider` in Phase 3.

The decision keeps both providers:

- `OpenAICompatibleProvider`: continues to work for OpenRouter, OpenAI, and any OpenAI-compatible endpoint.
- `AnthropicProvider`: direct Anthropic SDK integration for Claude models.

The `ModelProvider` interface already supports multiple implementations cleanly. Adding `AnthropicProvider` requires no changes to Agent Core, the tool system, or the permission system.

## 3. Provider Selection

Provider is selected through configuration:

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseURL": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4.1-mini"
  }
}
```

or:

```json
{
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-7"
  }
}
```

Secrets are provided through environment variables:

```text
ARVINCLAW_API_KEY        for openai-compatible
OPENROUTER_API_KEY       shortcut for OpenRouter
ANTHROPIC_API_KEY        for anthropic
```

## 4. Anthropic Tool Call Format

OpenAI and Anthropic use different formats for tool calling, but `ModelProvider` normalizes both into the same `ModelToolCallsOutput` shape:

| Concern | OpenAI format | Anthropic format | Normalized |
| --- | --- | --- | --- |
| Tool call in response | `message.tool_calls[]` | `content[].type === "tool_use"` | `ModelToolCallsOutput.calls[]` |
| Tool definition | `{ type: "function", function: { name, description, parameters } }` | `{ name, description, input_schema }` | `ModelToolDefinition` → converted per provider |
| Tool result | `{ role: "tool", tool_call_id, content }` | `{ type: "tool_result", tool_use_id, content }` | `ModelMessage.role === "tool"` → formatted per provider |

`AnthropicProvider` is responsible for translating between `ModelInput` / `ModelOutput` shapes and Anthropic's API format. Agent Core does not know which provider is active.

## 5. Streaming

The initial `AnthropicProvider` implementation does not need to support streaming. Non-streaming responses are sufficient for Phase 3 functionality.

Streaming support should be designed and added in Phase 6 when the Web UI requires real-time token display. At that point, `ModelProvider` may gain an optional `stream()` method or `generate()` may return an `AsyncIterable`.

## 6. Consequences

Positive:

- ArvinClaw users can use Claude directly without a proxy.
- ArvinClaw is better aligned with OpenClaw's primary model family.
- Anthropic SDK capabilities (caching, thinking) are accessible in later phases.
- The `ModelProvider` interface is validated by two real implementations.

Trade-offs:

- Adds `@anthropic-ai/sdk` as a dependency.
- Anthropic message format is more complex (content blocks vs simple strings).
- Two provider implementations to maintain.

## 7. What Does Not Change

- Agent Core loop.
- Tool system.
- Permission system.
- Session storage.
- Context assembly concepts.
- CLI adapter behavior.

## 8. Related Documents

- [Model Provider](../architecture/model-provider.md)
- [Reference Systems](../architecture/reference-systems.md)
- [Phase 3 Plan](../plans/phase-3-context-assembly-and-skills.md)
- [Main Design](../product/arvinclaw-design.md)

# Model Provider

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [model-provider.zh-CN.md](./model-provider.zh-CN.md)

## 1. Purpose

The model provider layer isolates Agent Core from specific LLM vendors and SDKs.

ArvinClaw should be able to start with one OpenAI-compatible provider, then later support Anthropic, Gemini, Ollama, local models, or other hosted models without rewriting the agent loop.

The core rule:

Agent Core depends on a stable `ModelProvider` interface, not on a vendor SDK.

## 2. Why This Layer Exists

Different model vendors vary in:

- API authentication
- Message format
- Tool calling format
- Streaming behavior
- Token usage reporting
- Error types
- Rate limit handling
- Model capability metadata

If Agent Core talks directly to one vendor API, those vendor details leak into planning, tool execution, tracing, and configuration. A provider layer keeps those concerns contained.

## 3. MVP Provider

The MVP should implement one provider:

```text
OpenAICompatibleProvider
```

This provider should support APIs that follow OpenAI-style chat completions or responses semantics closely enough to be configured through:

- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `maxTokens`

This gives the MVP a practical path to work with providers such as OpenAI-compatible hosted models or local gateways, while keeping the implementation small.

## 4. Responsibilities

The model provider layer owns:

- Translating ArvinClaw model input into provider-specific request format
- Translating provider output into ArvinClaw model output
- Normalizing tool calls
- Normalizing final assistant messages
- Normalizing provider errors
- Reporting usage metadata when available
- Supporting streaming later without changing Agent Core concepts

The model provider layer should not own:

- Agent planning
- Permission decisions
- Tool execution
- Skill loading
- Session persistence
- CLI rendering

## 5. Inputs and Outputs

### Model Input

The provider should receive a structured input from Agent Core:

- Messages
- Available tool definitions
- Model name
- Temperature
- Max token budget
- Optional response format hints
- Optional metadata for tracing

### Model Output

The provider should return a normalized output:

- Final assistant text, or
- Tool calls requested by the model, or
- A recoverable provider error

It may also include:

- Token usage
- Finish reason
- Provider request ID
- Raw provider metadata for debug trace mode

## 6. Tool Calling

Agent Core should not depend on one vendor's raw tool call format.

The provider should normalize tool requests into an internal shape, such as:

```ts
interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}
```

This lets the tool system validate and execute calls without knowing which LLM provider produced them.

## 7. Streaming

The MVP can start without full streaming support, but the provider interface should leave room for it.

Two future modes should be possible:

- Non-streaming: provider returns one complete `ModelOutput`.
- Streaming: provider emits text deltas, tool call deltas, usage updates, and final completion events.

The Agent Core should treat streaming as a delivery detail. The loop still needs a complete decision point before executing tools.

## 8. Error Normalization

Provider-specific errors should be normalized into a small set of categories:

- Authentication error
- Rate limit error
- Network error
- Invalid request
- Model unavailable
- Context length exceeded
- Unknown provider error

This lets Agent Core and adapters show useful messages without matching vendor-specific exception types.

## 9. Configuration

Model configuration should come from the merged effective configuration:

- Project config: `arvinclaw.config.json`
- User config: `~/.arvinclaw/config.json`
- Environment variables

Example:

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

Secrets should not be stored in project config. API keys should come from environment variables such as:

```text
ARVINCLAW_API_KEY
```

Future versions may support provider-specific keys:

```text
ARVINCLAW_OPENAI_API_KEY
ARVINCLAW_ANTHROPIC_API_KEY
ARVINCLAW_GEMINI_API_KEY
```

## 10. Capability Metadata

Different models support different capabilities. The provider layer should eventually expose capability metadata, such as:

- Supports tools
- Supports streaming
- Supports structured output
- Maximum context length
- Supports vision input
- Supports JSON mode

MVP can keep this simple and assume the configured model supports text and tool calling. Later versions should make capabilities explicit.

## 11. Provider Selection

The Agent Core should receive an already configured provider instance. It should not know how to read environment variables or instantiate vendor clients.

Provider setup belongs to application composition:

```text
CLI startup
  -> Load config
  -> Create provider
  -> Create tools
  -> Create permissions
  -> Create AgentRuntime
```

This keeps runtime logic separate from app bootstrapping.

## 12. Future Providers

Likely future providers:

- Anthropic provider
- Gemini provider
- Ollama provider
- Local OpenAI-compatible provider
- Router provider that chooses among multiple configured providers

The router provider can support future behavior such as:

- Fallback on failure
- Cheap model for planning
- Stronger model for final synthesis
- Local model for private tasks
- Hosted model for complex reasoning

## 13. Minimal Interface

The implementation plan should refine exact types, but the architecture expects a concept like:

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

These interfaces are illustrative, not final implementation contracts.

## 14. Acceptance Criteria

The MVP model provider layer should be considered successful when:

- Agent Core calls a `ModelProvider` interface.
- The OpenAI-compatible provider can send messages and receive a normalized response.
- Tool calls are normalized into ArvinClaw's internal shape.
- Provider errors are normalized enough for the CLI to explain them.
- API keys are loaded from environment variables, not project config.
- A future provider can be added without changing Agent Core's main loop.

## 15. Related Documents

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Configuration System](./configuration-system.md)
- [Agent loop](./agent-loop.md)
- [Project structure](./project-structure.md)

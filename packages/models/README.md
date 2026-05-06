# Models Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@peewit/models` defines the **provider-neutral model contract** and implements concrete providers behind it. All other packages that need to call an LLM depend only on the `ModelProvider` interface — never on a vendor SDK directly.

```
@peewit/core
    │  uses
    ▼
ModelProvider (interface)
    │  implemented by
    ├─ OpenAICompatibleProvider  (fetch-based, SSE streaming)
    ├─ AnthropicProvider         (Anthropic SDK, with injectable client)
    └─ FakeModelProvider         (test double)
```

The models package is the only package that imports `@anthropic-ai/sdk`. All vendor-specific message formats, stop reasons, tool call shapes, and error codes are normalized here and never leak upward.

## Core Concepts

### ModelProvider / StreamingModelProvider

`ModelProvider` has a single method: `generate(input: ModelInput): Promise<ModelOutput>`.

`StreamingModelProvider` extends it with `generateStream(input: ModelInput): AsyncIterable<StreamEvent>`.

`isStreamingProvider(provider)` is a runtime type guard. The core runtime calls it to decide whether to use `generate` or `generateStream` based on `preferStreaming`.

### ModelInput / ModelOutput

`ModelInput` is the canonical request format:

```typescript
interface ModelInput {
  messages: ModelMessage[];      // system/user/assistant/tool roles
  tools?: ModelToolDefinition[]; // JSON schema function definitions
  options?: ModelRequestOptions; // model, temperature, maxTokens overrides
}
```

`ModelOutput` is a discriminated union with three variants:

| type | When emitted | Contains |
|---|---|---|
| `"message"` | Model returned plain text | `content: string`, optional `usage` |
| `"tool_calls"` | Model requested tool calls | `calls: ModelToolCall[]`, optional `usage` |
| `"error"` | Request failed | `category`, `message`, `recoverable: boolean` |

Error categories (`authentication`, `rate_limit`, `network`, `invalid_request`, `model_unavailable`, `context_length`, `unknown`) allow callers to make informed retry decisions.

### StreamEvent

`generateStream` yields a stream of `StreamEvent` objects:

| type | When emitted |
|---|---|
| `"token_delta"` | Each text token arrives |
| `"message_done"` | Stream completed as a text message |
| `"tool_calls"` | Stream completed as tool calls |
| `"error"` | Stream failed |

The runtime accumulates `token_delta` events (yielding each to adapters immediately for live display) and converts the terminal event back into a `ModelOutput`-compatible shape for the rest of the loop logic.

## Implementation Principles

### OpenAICompatibleProvider

Uses the `fetch` API (injectable via `config.fetch` for testing) to call any OpenAI-compatible `/chat/completions` endpoint (OpenRouter, local models, etc.).

**Non-streaming path**: POSTs JSON, parses `choices[0]`, maps `finish_reason: "tool_calls"` → `ModelOutput.tool_calls`, otherwise → `ModelOutput.message`.

**Streaming path**: Adds `stream: true` to the request body. Parses Server-Sent Events (SSE) using `parseSSEStream`, which reads the response body as a `ReadableStream<Uint8Array>`, buffers partial lines, and yields `data: …` payloads. Tool call arguments are accumulated across multiple `index`-keyed delta chunks using a `Map<index, accumulator>`.

### AnthropicProvider

Uses the `@anthropic-ai/sdk` with an **injectable client** for testability. Two separate client interfaces are injected:

- `AnthropicClientLike` — for non-streaming `messages.create()`.
- `AnthropicStreamClientLike` — for streaming `messages.stream()`.

The split allows tests to inject a fake streaming client without affecting the non-streaming path.

**Message translation** (`translateMessagesToAnthropic`):
- `system` role → extracted as a separate `system` array with `cache_control: { type: "ephemeral" }` (enables prompt caching).
- Consecutive `tool` role messages → merged into a single `user` message with `tool_result` content blocks.
- `assistant` with `toolCalls` → `assistant` with mixed `text` + `tool_use` content blocks.

**Streaming path**: Processes raw stream events (`content_block_start`, `content_block_delta`, `message_delta`). Text deltas are yielded as `token_delta`. Tool input JSON is accumulated per block index into `partial_json` strings and parsed at stream end.

**Fallback**: If `streamClient` is not available (shouldn't happen in production), `generateStream` falls back to `generate` and wraps the result as a single-event stream.

### ThinkingBudget

Maps a human-readable budget level to Anthropic extended thinking API parameters:

| Budget | API param |
|---|---|
| `"off"` / undefined | No `thinking` field |
| `"adaptive"` | `{ type: "adaptive" }` |
| `"minimal"` | `{ type: "enabled", budget_tokens: 1024 }` |
| `"low"` | `{ type: "enabled", budget_tokens: 2048 }` |
| `"medium"` | `{ type: "enabled", budget_tokens: 4096 }` |
| `"high"` | `{ type: "enabled", budget_tokens: 8192 }` |
| `"max"` | `{ type: "enabled", budget_tokens: 16384 }` |

### FakeModelProvider / FakeStreamingProvider

Both are test doubles with a pre-loaded output queue (`outputs` / `tokenSequences`). They record all `generate` inputs to a public `requests` array so tests can assert what was sent to the model. `FakeStreamingProvider.generate()` collapses a token sequence to a single message, so tests that use the non-streaming path also work.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares public package exports and build scripts. Depends on `@anthropic-ai/sdk`. |
| `tsconfig.json` | TypeScript config | Builds the models package. |
| `src/index.ts` | Provider layer | All exports: `ModelProvider`, `StreamingModelProvider`, `isStreamingProvider`, `ModelInput/Output/Message/ToolDefinition`, `StreamEvent`, `OpenAICompatibleProvider`, `AnthropicProvider`, `AnthropicProviderConfig`, `ThinkingBudget`, `FakeModelProvider`, `FakeStreamingProvider`. |
| `src/index.test.ts` | Provider tests | Protects fake provider behavior, streaming detection, SSE parsing, Anthropic message translation, tool call accumulation, thinking budget mapping, and error category normalization. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

# Module 02: @vole/models

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `03-models.zh-CN.md` (create alongside this file)

Related source: `packages/models/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [02-core.md](./02-core.md) so you already know where `ModelProvider` is called
from inside the loop.

**Before reading**: Skim `packages/models/src/index.ts` top-to-bottom once — just to see
what is exported. Then read this document to understand the design decisions.

**Focus questions**:
- Why does `ModelProvider` have only one method?
- Why is `ModelErrorOutput` part of `ModelOutput` rather than a thrown exception?
- How does `FakeModelProvider` enable testing without real API calls?
- Why does Anthropic message translation happen inside the provider, not in core?

**Checkpoint**: You understand this module when you can explain what `core` receives from
`ModelProvider` and why it never needs to know which vendor is being used.

## 1. What This Module Does

`@vole/models` wraps all vendor-specific model APIs behind a single `ModelProvider` interface.
It translates the internal `ModelMessage[]` format into each vendor's wire format, calls the
API, and normalises the response back to `ModelOutput`.

It is the only package in the codebase that imports vendor SDKs (`@anthropic-ai/sdk`) or
makes HTTP calls to model APIs.

## 2. Why It Exists

If `@vole/core` called the Anthropic SDK directly, then:
- Switching models would require editing the loop
- Testing the loop would require real API calls or complex mocking
- Adding a new provider would touch core logic

`@vole/models` creates a hard seam: core depends on an interface (`ModelProvider`), not on
any concrete vendor. Vendor details — API format, auth headers, streaming protocol, error
codes — are entirely contained in this package.

## 3. Public Interface

```ts
// The core contract: one method, one input, one output.
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>
}

// Optional streaming extension — inherits ModelProvider.
interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>
}

// The three possible outcomes from any model call.
type ModelOutput =
  | { type: "message"; content: string; usage?: ModelUsage }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean }

// Internal message format — shared across all providers.
interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCallId?: string       // present on tool result messages
  toolCalls?: ModelToolCall[] // present on assistant messages that called tools
}

// Concrete providers
class AnthropicProvider implements StreamingModelProvider { ... }
class OpenAICompatibleProvider implements StreamingModelProvider { ... }

// Test doubles
class FakeModelProvider implements ModelProvider { ... }
class FakeStreamingProvider implements StreamingModelProvider { ... }
```

The `isStreamingProvider()` type guard lets core check at runtime whether a provider
supports streaming without requiring a specific base class.

## 4. Implementation Walkthrough

Every provider follows the same three-step path:

**Step 1 — Translate input**
Convert `ModelMessage[]` from the internal format to the vendor's wire format.
For `AnthropicProvider`: `translateMessagesToAnthropic()` handles the structural differences:
- Consecutive `tool` messages are merged into one `user` message with `tool_result` content blocks.
- `assistant` messages with tool calls become content blocks of type `tool_use`.

For `OpenAICompatibleProvider`: the internal format maps closely to OpenAI's format, so
translation is simpler.

**Step 2 — Call the API**
`AnthropicProvider.generate()` calls `this.#client.messages.create()`.
`OpenAICompatibleProvider.generate()` calls `fetch()` to the configured base URL.

Both handle errors without `throw`: network failures and API errors become
`{ type: "error", ... }` values.

**Step 3 — Normalize output**
The vendor response is mapped to one of three `ModelOutput` shapes:
- `stop_reason === "tool_use"` → `{ type: "tool_calls" }`
- Text content → `{ type: "message" }`
- Any failure → `{ type: "error", recoverable: boolean }`

The streaming path follows the same structure but uses `AsyncIterable<StreamEvent>` to
yield `token_delta` events as tokens arrive, then a final `message_done` or `tool_calls`
event when the stream ends.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Model provider abstraction layer | `ModelProvider` / `StreamingModelProvider` | Same pattern |
| Provider-neutral message format | `ModelMessage[]` | OpenClaw also uses an internal format |
| Fake providers for testing | `FakeModelProvider`, `FakeStreamingProvider` | Standard test double pattern |

`ThinkingBudget` (`off` / `adaptive` / `minimal` … `max`) aligns with OpenClaw's documented
thinking budget levels, which Vole defers until later phases for configuration surfaces. The
provider already supports it.

## 6. Key Design Decisions

**Errors as values, not exceptions**

`ModelErrorOutput` is a member of `ModelOutput`, not a thrown exception. Core handles it
with `if (output.type === "error")` rather than `try/catch`. This makes the error path
explicit and composable — the caller always knows it must handle all three output types.

`recoverable: boolean` is embedded in the error. `rate_limit` and `network` errors are
recoverable (retry is meaningful). `invalid_request` and `authentication` errors are not
(retrying produces the same result). Core can use this flag to decide whether to surface
the error or attempt recovery.

**Streaming is an optional extension**

`StreamingModelProvider extends ModelProvider`. A provider that only implements `generate()`
is still a valid `ModelProvider`. Core checks `isStreamingProvider()` at runtime via duck
typing — `"generateStream" in provider` — rather than requiring inheritance from a specific
base class. This avoids the diamond-inheritance problem and keeps providers loosely coupled.

**Message translation lives in providers, not in core**

Anthropic and OpenAI have fundamentally different message schemas. Putting `translateMessagesToAnthropic()` inside `AnthropicProvider` means core is never exposed to vendor-specific
structures. If Anthropic changes its API, only `AnthropicProvider` needs to change.

**`FakeModelProvider` records requests**

```ts
class FakeModelProvider {
  readonly requests: ModelInput[] = []  // public, readable by tests
  ...
}
```

`requests` is public so tests can assert on what was *sent* to the model, not just what came
back. Tests like "second call includes tool result in messages" become straightforward
assertions on `provider.requests[1].messages`.

## 7. Testing Approach

Tests are in `packages/models/src/index.test.ts`. No real API calls are made anywhere in
the test suite — all network interactions are tested via injectable `fetch` (for
`OpenAICompatibleProvider`) and injectable client instances (for `AnthropicProvider`).

`FakeModelProvider` uses a queue pattern: the constructor takes `outputs: ModelOutput[]`.
Each `generate()` call pops the front of the queue. If the queue is empty, it returns a
`recoverable: false` error. This lets tests script exact multi-turn conversations:

```ts
new FakeModelProvider([
  { type: "tool_calls", calls: [{ name: "read_file", ... }] },
  { type: "message", content: "Here is the summary." }
])
```

Test categories:
- `ModelProvider` interface contract (generate returns correct output types)
- Message format translation (system messages, tool calls, tool results)
- Error normalisation (HTTP 401 → `authentication`, 429 → `rate_limit`)
- Streaming path (token deltas, tool call accumulation, SSE parsing)
- `FakeModelProvider` queue exhaustion behavior

## 8. Insights

**`ModelOutput` as a discriminated union forces exhaustive handling.** TypeScript will
produce a compile error if you add a new output type but forget to handle it in core's
`if/else` chain. The union is the contract; the type checker enforces it.

**The system prompt gets `cache_control: ephemeral` in `AnthropicProvider.generate()`.** This
tells Anthropic's API to cache the system prompt across calls with the same content. Since
Vole's system prompt is long (tools, skills, permission guidance) and rebuilt on every turn,
caching it avoids reprocessing cost. This is transparent to core and adapters — they never
know it's happening.

**`isStreamingProvider()` uses duck typing, not `instanceof`.** This matters when providers
are wrapped or proxied — `instanceof` would fail on a wrapper class, but duck typing checks
the actual capability.

**`OpenAICompatibleProvider` works against any OpenAI-format endpoint.** The `baseURL`
config means it can target OpenRouter, local `ollama`, or any other OpenAI-compatible host.
The same class serves all of them.

## 9. Review Questions

1. Why does `ModelProvider` have only one method (`generate`)? What responsibility does it
   explicitly exclude?
   > It only promises: given messages, return a model output. It excludes session management,
   > streaming protocol details, error retry logic, and vendor authentication. All of these
   > are either handled inside the provider implementation or in the caller (core).

2. What are the three `ModelOutput` variants and what does core do with each?
   > `message` → emit `assistant_message_created`, end the turn.
   > `tool_calls` → for each call, evaluate permission and execute.
   > `error` → emit `run_failed` immediately; if `recoverable: true`, the error could
   > theoretically be retried (but core currently always terminates on model error).

3. Why does `ModelErrorOutput` use `recoverable: boolean` instead of just having error types?
   > Because recoverability depends on the error type AND the context. Embedding `recoverable`
   > in the output means the provider — which knows the error — makes the judgment. The caller
   > does not need to map error categories to recover decisions.

4. Why does Anthropic message translation happen inside `AnthropicProvider` rather than in core?
   > Core uses a single internal `ModelMessage[]` format. If translation lived in core, core
   > would need to know about every vendor's wire format. Moving it to the provider isolates
   > the change surface: a new vendor = a new provider class, no core changes.

5. How does `FakeModelProvider` enable multi-step turn testing without real API calls?
   > It takes a queue of `ModelOutput` in its constructor and pops one per `generate()` call.
   > Tests script exact conversation sequences. `requests` records every `ModelInput` received,
   > so tests can also assert on what context was sent to the model at each step.

6. `StreamingModelProvider extends ModelProvider` — what does this mean for a provider that
   only implements `generate()`?
   > It is still a valid `ModelProvider` and can be used anywhere `ModelProvider` is expected.
   > Core only activates the streaming path when `isStreamingProvider()` returns `true` AND
   > `preferStreaming` is enabled. A non-streaming provider degrades gracefully.

7. What is `cache_control: { type: "ephemeral" }` on the system prompt, and why does it
   only appear in `AnthropicProvider`?
   > It is Anthropic-specific prompt caching: the system prompt content is cached server-side
   > and not reprocessed on repeated calls. It only appears in `AnthropicProvider` because
   > it is a vendor-specific feature — core and context assembly have no awareness of it.

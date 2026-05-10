/**
 * INPUT: Provider-neutral model messages, tool definitions, request options, optional fetch implementation, optional injectable Anthropic client, and optional thinkingBudget for Anthropic extended thinking.
 * OUTPUT: ModelProvider contracts, StreamingModelProvider contracts, StreamEvent types, ModelToolDefinition, tool_calls response parsing, fake provider, fake streaming provider, OpenAI-compatible provider (with streaming), Anthropic provider (with streaming and thinking budget support), and ThinkingBudget type.
 * POS: Model provider layer; isolates Agent Core from vendor-specific APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import Anthropic from "@anthropic-ai/sdk";

export const modelsPackageName = "@vole/models";

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelMessage {
  role: ModelMessageRole;
  content: string | null;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ModelRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelInput {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  options?: ModelRequestOptions;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelMessageOutput {
  type: "message";
  content: string;
  usage?: ModelUsage;
}

export interface ModelToolCallsOutput {
  type: "tool_calls";
  calls: ModelToolCall[];
  /** Text the model generated alongside the tool calls in the same response turn. */
  text?: string;
  usage?: ModelUsage;
}

export type ModelErrorCategory =
  | "authentication"
  | "rate_limit"
  | "network"
  | "invalid_request"
  | "model_unavailable"
  | "context_length"
  | "unknown";

export interface ModelErrorOutput {
  type: "error";
  category: ModelErrorCategory;
  message: string;
  recoverable: boolean;
}

export type ModelOutput = ModelMessageOutput | ModelToolCallsOutput | ModelErrorOutput;

export interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "token_delta"; delta: string }
  | { type: "tool_calls"; calls: ModelToolCall[]; text?: string; usage?: ModelUsage }
  | { type: "message_done"; content: string; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean };

export interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>;
}

export function isStreamingProvider(provider: ModelProvider): provider is StreamingModelProvider {
  return (
    "generateStream" in provider &&
    typeof (provider as { generateStream: unknown }).generateStream === "function"
  );
}

// ─── OpenAI-compatible Provider ───────────────────────────────────────────────

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  fetch?: FetchLike;
}

interface OpenAIToolCallFunction {
  name: string;
  arguments: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: OpenAIToolCallFunction;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatibleProvider implements StreamingModelProvider {
  readonly #baseURL: string;
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #temperature: number | undefined;
  readonly #maxTokens: number | undefined;
  readonly #fetch: FetchLike;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.#baseURL = config.baseURL.replace(/\/+$/, "");
    this.#apiKey = config.apiKey;
    this.#model = config.model;
    this.#temperature = config.temperature;
    this.#maxTokens = config.maxTokens;
    this.#fetch = config.fetch ?? fetch;
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    try {
      const response = await this.#fetch(`${this.#baseURL}/chat/completions`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(this.#body(input))
      });

      if (!response.ok) {
        return {
          type: "error",
          category: this.#errorCategory(response.status),
          message: `Provider request failed with status ${response.status}.`,
          recoverable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
        };
      }

      const data = (await response.json()) as OpenAIChatCompletionResponse;
      const choice = data.choices?.[0];
      const finishReason = choice?.finish_reason;
      const message = choice?.message;
      const rawToolCalls = message?.tool_calls;

      if (finishReason === "tool_calls" && rawToolCalls !== undefined && rawToolCalls.length > 0) {
        const priorText = message?.content ?? "";
        return {
          type: "tool_calls",
          calls: rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            input: parseToolCallArguments(tc.function.arguments)
          })),
          ...(priorText ? { text: priorText } : {}),
          ...(data.usage ? { usage: this.#usage(data.usage) } : {})
        };
      }

      return {
        type: "message",
        content: message?.content ?? "",
        ...(data.usage ? { usage: this.#usage(data.usage) } : {})
      };
    } catch {
      return {
        type: "error",
        category: "network",
        message: "Provider network request failed.",
        recoverable: true
      };
    }
  }

  async *generateStream(input: ModelInput): AsyncIterable<StreamEvent> {
    try {
      const response = await this.#fetch(`${this.#baseURL}/chat/completions`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ ...this.#body(input), stream: true })
      });

      if (!response.ok) {
        yield {
          type: "error",
          category: this.#errorCategory(response.status),
          message: `Provider request failed with status ${response.status}.`,
          recoverable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
        };
        return;
      }

      if (response.body === null) {
        yield { type: "error", category: "network", message: "No response body for streaming request.", recoverable: true };
        return;
      }

      const toolAccumulators = new Map<number, { id: string; name: string; arguments: string }>();
      let textContent = "";
      let usage: ModelUsage | undefined;
      let finishReason: string | null = null;

      for await (const data of parseSSEStream(response.body)) {
        if (data === "[DONE]") break;

        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (choice !== undefined) {
          if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (delta !== undefined) {
            if (delta.content) {
              textContent += delta.content;
              yield { type: "token_delta", delta: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolAccumulators.has(tc.index)) {
                  toolAccumulators.set(tc.index, { id: "", name: "", arguments: "" });
                }
                const acc = toolAccumulators.get(tc.index)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              }
            }
          }
        }

        if (chunk.usage) {
          usage = this.#usage(chunk.usage);
        }
      }

      if (finishReason === "tool_calls" && toolAccumulators.size > 0) {
        const calls = Array.from(toolAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([, acc]) => ({
            id: acc.id,
            name: acc.name,
            input: parseToolCallArguments(acc.arguments)
          }));
        yield { type: "tool_calls", calls, ...(textContent ? { text: textContent } : {}), ...(usage !== undefined ? { usage } : {}) };
      } else {
        yield { type: "message_done", content: textContent, ...(usage !== undefined ? { usage } : {}) };
      }
    } catch {
      yield { type: "error", category: "network", message: "Provider network request failed.", recoverable: true };
    }
  }

  #headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {})
    };
  }

  #body(input: ModelInput): Record<string, unknown> {
    return {
      model: this.#model,
      messages: input.messages.map((m) => this.#formatMessage(m)),
      ...(input.tools !== undefined && input.tools.length > 0 ? { tools: input.tools } : {}),
      ...(this.#temperature === undefined ? {} : { temperature: this.#temperature }),
      ...(this.#maxTokens === undefined ? {} : { max_tokens: this.#maxTokens })
    };
  }

  #formatMessage(message: ModelMessage): Record<string, unknown> {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content ?? ""
      };
    }
    if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: typeof call.input === "string" ? call.input : JSON.stringify(call.input)
          }
        }))
      };
    }
    return { role: message.role, content: message.content };
  }

  #errorCategory(status: number): ModelErrorCategory {
    if (status === 401 || status === 403) {
      return "authentication";
    }
    if (status === 429) {
      return "rate_limit";
    }
    if (status === 400 || status === 422) {
      return "invalid_request";
    }
    if (status === 404 || status === 503) {
      return "model_unavailable";
    }

    return "unknown";
  }

  #usage(usage: NonNullable<OpenAIChatCompletionResponse["usage"]>): ModelUsage {
    return {
      ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
      ...(usage.completion_tokens === undefined ? {} : { outputTokens: usage.completion_tokens }),
      ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens })
    };
  }
}

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          yield trimmed.slice(6);
        }
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        yield trimmed.slice(6);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseToolCallArguments(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export class FakeModelProvider implements ModelProvider {
  readonly requests: ModelInput[] = [];

  readonly #outputs: ModelOutput[];

  constructor(outputs: ModelOutput[]) {
    this.#outputs = [...outputs];
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    this.requests.push(input);
    const output = this.#outputs.shift();

    return (
      output ?? {
        type: "error",
        category: "unknown",
        message: "FakeModelProvider has no queued output.",
        recoverable: false
      }
    );
  }
}

export class FakeStreamingProvider implements StreamingModelProvider {
  readonly requests: ModelInput[] = [];

  readonly #tokenSequences: Array<string[] | ModelToolCall[]>;

  constructor(tokenSequences: Array<string[] | ModelToolCall[]>) {
    this.#tokenSequences = [...tokenSequences];
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    this.requests.push(input);
    const seq = this.#tokenSequences.shift();
    if (seq === undefined) {
      return { type: "error", category: "unknown", message: "FakeStreamingProvider has no queued sequence.", recoverable: false };
    }
    if (seq.length > 0 && typeof seq[0] === "object" && seq[0] !== null && "name" in seq[0]) {
      return { type: "tool_calls", calls: seq as ModelToolCall[] };
    }
    return { type: "message", content: (seq as string[]).join("") };
  }

  async *generateStream(input: ModelInput): AsyncIterable<StreamEvent> {
    this.requests.push(input);
    const seq = this.#tokenSequences.shift();
    if (seq === undefined) {
      yield { type: "error", category: "unknown", message: "FakeStreamingProvider has no queued sequence.", recoverable: false };
      return;
    }

    if (seq.length > 0 && typeof seq[0] === "object" && seq[0] !== null && "name" in seq[0]) {
      yield { type: "tool_calls", calls: seq as ModelToolCall[] };
      return;
    }

    const tokens = seq as string[];
    for (const token of tokens) {
      yield { type: "token_delta", delta: token };
    }
    yield { type: "message_done", content: tokens.join("") };
  }
}

// ─── Anthropic Provider ────────────────────────────────────────────────────

// Internal types for Anthropic API format (not exported).
type AnthropicUserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicAssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

type AnthropicAPIParam =
  | { role: "user"; content: string | AnthropicUserBlock[] }
  | { role: "assistant"; content: string | AnthropicAssistantBlock[] };

interface AnthropicAPIToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface AnthropicAPIResponse {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

type AnthropicSystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

type AnthropicThinkingParam =
  | { type: "enabled"; budget_tokens: number }
  | { type: "adaptive" }
  | { type: "disabled" };

type AnthropicBaseParams = {
  model: string;
  max_tokens: number;
  system?: AnthropicSystemBlock[];
  messages: AnthropicAPIParam[];
  tools?: AnthropicAPIToolDef[];
  temperature?: number;
  thinking?: AnthropicThinkingParam;
};

// Minimal streaming event types compatible with the Anthropic SDK's RawMessageStreamEvent.
type AnthropicRawStreamEvent =
  | { type: "message_start"; message: { usage: { input_tokens: number; output_tokens: number } } }
  | { type: "message_delta"; delta: { stop_reason: string | null }; usage: { output_tokens: number } }
  | { type: "message_stop" }
  | { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "ping" };

interface AnthropicClientLike {
  messages: {
    create(params: AnthropicBaseParams): Promise<AnthropicAPIResponse>;
  };
}

// Injectable stream client for testing the Anthropic streaming path.
export interface AnthropicStreamClientLike {
  messages: {
    stream(params: AnthropicBaseParams): Promise<AsyncIterable<AnthropicRawStreamEvent>>;
  };
}

export type ThinkingBudget = "off" | "minimal" | "low" | "medium" | "high" | "max" | "adaptive";

const THINKING_BUDGET_TOKENS: Record<Exclude<ThinkingBudget, "off" | "adaptive">, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  max: 16384
};

export interface AnthropicProviderConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: ThinkingBudget;
  client?: AnthropicClientLike;
  streamClient?: AnthropicStreamClientLike;
}

export class AnthropicProvider implements StreamingModelProvider {
  readonly #client: AnthropicClientLike;
  readonly #streamClient: AnthropicStreamClientLike | undefined;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #temperature: number | undefined;
  readonly #thinkingBudget: ThinkingBudget | undefined;

  constructor(config: AnthropicProviderConfig) {
    this.#model = config.model;
    this.#maxTokens = config.maxTokens ?? 4096;
    this.#temperature = config.temperature;
    this.#thinkingBudget = config.thinkingBudget;

    if (config.client !== undefined || config.streamClient !== undefined) {
      this.#client = config.client ?? { messages: { create: async () => { throw new Error("No client provided."); } } };
      this.#streamClient = config.streamClient;
    } else {
      const sdk = new Anthropic({ apiKey: config.apiKey });
      this.#client = sdk as unknown as AnthropicClientLike;
      this.#streamClient = {
        messages: {
          stream: (params) =>
            sdk.messages.create({ ...params, stream: true }) as unknown as Promise<AsyncIterable<AnthropicRawStreamEvent>>
        }
      };
    }
  }

  #buildThinkingParam(): AnthropicThinkingParam | undefined {
    const budget = this.#thinkingBudget;
    if (budget === undefined || budget === "off") return undefined;
    if (budget === "adaptive") return { type: "adaptive" };
    const tokens = THINKING_BUDGET_TOKENS[budget];
    return { type: "enabled", budget_tokens: tokens };
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    try {
      const { system, messages } = translateMessagesToAnthropic(input.messages);

      const systemBlocks: AnthropicSystemBlock[] | undefined =
        system !== undefined
          ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
          : undefined;

      const thinkingParam = this.#buildThinkingParam();

      const response = await this.#client.messages.create({
        model: this.#model,
        max_tokens: this.#maxTokens,
        ...(systemBlocks !== undefined ? { system: systemBlocks } : {}),
        messages,
        ...(input.tools !== undefined && input.tools.length > 0
          ? { tools: translateToolsToAnthropic(input.tools) }
          : {}),
        ...(this.#temperature !== undefined ? { temperature: this.#temperature } : {}),
        ...(thinkingParam !== undefined ? { thinking: thinkingParam } : {})
      });

      const toolUseBlocks = response.content.filter(isToolUseBlock);

      if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
        const textBlock = response.content.find(isTextBlock);
        return {
          type: "tool_calls",
          calls: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
          ...(textBlock?.text ? { text: textBlock.text } : {}),
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        };
      }

      const textBlock = response.content.find(isTextBlock);
      return {
        type: "message",
        content: textBlock?.text ?? "",
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      };
    } catch (error) {
      return normalizeAnthropicError(error);
    }
  }

  async *generateStream(input: ModelInput): AsyncIterable<StreamEvent> {
    if (this.#streamClient === undefined) {
      // Fallback: wrap the non-streaming response as a single stream event.
      const output = await this.generate(input);
      if (output.type === "message") {
        yield { type: "token_delta", delta: output.content };
        yield { type: "message_done", content: output.content, ...(output.usage ? { usage: output.usage } : {}) };
      } else if (output.type === "tool_calls") {
        yield { type: "tool_calls", calls: output.calls, ...(output.usage ? { usage: output.usage } : {}) };
      } else {
        yield { type: "error", category: output.category, message: output.message, recoverable: output.recoverable };
      }
      return;
    }

    try {
      const { system, messages } = translateMessagesToAnthropic(input.messages);

      const systemBlocks: AnthropicSystemBlock[] | undefined =
        system !== undefined
          ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
          : undefined;

      const thinkingParam = this.#buildThinkingParam();
      const params: AnthropicBaseParams = {
        model: this.#model,
        max_tokens: this.#maxTokens,
        ...(systemBlocks !== undefined ? { system: systemBlocks } : {}),
        messages,
        ...(input.tools !== undefined && input.tools.length > 0
          ? { tools: translateToolsToAnthropic(input.tools) }
          : {}),
        ...(this.#temperature !== undefined ? { temperature: this.#temperature } : {}),
        ...(thinkingParam !== undefined ? { thinking: thinkingParam } : {})
      };

      const stream = await this.#streamClient.messages.stream(params);

      let textContent = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: string | null = null;
      const toolBlocks = new Map<number, { id: string; name: string; inputJson: string }>();

      for await (const event of stream) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage.input_tokens;
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolBlocks.set(event.index, {
              id: event.content_block.id ?? "",
              name: event.content_block.name ?? "",
              inputJson: ""
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            textContent += event.delta.text;
            yield { type: "token_delta", delta: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            const block = toolBlocks.get(event.index);
            if (block !== undefined) {
              block.inputJson += event.delta.partial_json;
            }
          }
        } else if (event.type === "message_delta") {
          outputTokens = event.usage.output_tokens;
          stopReason = event.delta.stop_reason;
        }
      }

      const usage: ModelUsage = { inputTokens, outputTokens };

      if (stopReason === "tool_use" && toolBlocks.size > 0) {
        const calls = Array.from(toolBlocks.entries())
          .sort(([a], [b]) => a - b)
          .map(([, block]) => ({
            id: block.id,
            name: block.name,
            input: parseToolCallArguments(block.inputJson)
          }));
        yield { type: "tool_calls", calls, ...(textContent ? { text: textContent } : {}), usage };
      } else {
        yield { type: "message_done", content: textContent, usage };
      }
    } catch (error) {
      yield normalizeAnthropicError(error) as StreamEvent & { type: "error" };
    }
  }
}

function translateMessagesToAnthropic(messages: ModelMessage[]): {
  system: string | undefined;
  messages: AnthropicAPIParam[];
} {
  let system: string | undefined;
  const result: AnthropicAPIParam[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (msg === undefined) break;

    if (msg.role === "system") {
      system = msg.content ?? undefined;
      i++;
      continue;
    }

    if (msg.role === "tool") {
      // Consecutive tool messages become one user message with tool_result blocks.
      const blocks: AnthropicUserBlock[] = [];
      while (i < messages.length) {
        const tm = messages[i];
        if (tm === undefined || tm.role !== "tool") break;
        blocks.push({ type: "tool_result", tool_use_id: tm.toolCallId ?? "", content: tm.content ?? "" });
        i++;
      }
      result.push({ role: "user", content: blocks });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        const blocks: AnthropicAssistantBlock[] = [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ...msg.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input }))
        ];
        result.push({ role: "assistant", content: blocks });
      } else {
        result.push({ role: "assistant", content: msg.content ?? "" });
      }
      i++;
      continue;
    }

    // user message
    result.push({ role: "user", content: msg.content ?? "" });
    i++;
  }

  return { system, messages: result };
}

function translateToolsToAnthropic(tools: ModelToolDefinition[]): AnthropicAPIToolDef[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: {
      type: "object" as const,
      ...(t.function.parameters.properties !== undefined ? { properties: t.function.parameters.properties } : {}),
      ...(t.function.parameters.required !== undefined ? { required: t.function.parameters.required } : {})
    }
  }));
}

function isToolUseBlock(
  block: { type: string; [key: string]: unknown }
): block is { type: "tool_use"; id: string; name: string; input: unknown } {
  return block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string";
}

function isTextBlock(
  block: { type: string; [key: string]: unknown }
): block is { type: "text"; text: string } {
  return block.type === "text" && typeof block.text === "string";
}

function normalizeAnthropicError(error: unknown): ModelErrorOutput {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const apiError = error as { status: number; message?: string };
    return {
      type: "error",
      category: anthropicErrorCategory(apiError.status),
      message: apiError.message ?? `Anthropic API error ${apiError.status}.`,
      recoverable: apiError.status === 429 || apiError.status >= 500
    };
  }
  return {
    type: "error",
    category: "network",
    message: "Provider network request failed.",
    recoverable: true
  };
}

function anthropicErrorCategory(status: number): ModelErrorCategory {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status === 400) return "invalid_request";
  if (status === 404) return "model_unavailable";
  if (status === 413 || status === 422) return "context_length";
  return "unknown";
}

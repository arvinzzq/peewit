/**
 * INPUT: Provider-neutral model messages, tool definitions, request options, optional fetch implementation, and optional injectable Anthropic client.
 * OUTPUT: ModelProvider contracts, ModelToolDefinition, tool_calls response parsing, fake provider, OpenAI-compatible provider, and Anthropic provider.
 * POS: Model provider layer; isolates Agent Core from vendor-specific APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import Anthropic from "@anthropic-ai/sdk";

export const modelsPackageName = "@arvinclaw/models";

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

export class OpenAICompatibleProvider implements ModelProvider {
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
        return {
          type: "tool_calls",
          calls: rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            input: parseToolCallArguments(tc.function.arguments)
          })),
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

interface AnthropicClientLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: AnthropicSystemBlock[];
      messages: AnthropicAPIParam[];
      tools?: AnthropicAPIToolDef[];
      temperature?: number;
    }): Promise<AnthropicAPIResponse>;
  };
}

export interface AnthropicProviderConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  client?: AnthropicClientLike;
}

export class AnthropicProvider implements ModelProvider {
  readonly #client: AnthropicClientLike;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #temperature: number | undefined;

  constructor(config: AnthropicProviderConfig) {
    this.#model = config.model;
    this.#maxTokens = config.maxTokens ?? 4096;
    this.#temperature = config.temperature;
    this.#client = config.client ?? (new Anthropic({ apiKey: config.apiKey }) as unknown as AnthropicClientLike);
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    try {
      const { system, messages } = translateMessagesToAnthropic(input.messages);

      const systemBlocks: AnthropicSystemBlock[] | undefined =
        system !== undefined
          ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
          : undefined;

      const response = await this.#client.messages.create({
        model: this.#model,
        max_tokens: this.#maxTokens,
        ...(systemBlocks !== undefined ? { system: systemBlocks } : {}),
        messages,
        ...(input.tools !== undefined && input.tools.length > 0
          ? { tools: translateToolsToAnthropic(input.tools) }
          : {}),
        ...(this.#temperature !== undefined ? { temperature: this.#temperature } : {})
      });

      const toolUseBlocks = response.content.filter(isToolUseBlock);

      if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
        return {
          type: "tool_calls",
          calls: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
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

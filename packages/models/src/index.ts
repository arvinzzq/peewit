export const modelsPackageName = "@arvinclaw/models";

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelInput {
  messages: ModelMessage[];
  options?: ModelRequestOptions;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
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

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
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
      const content = data.choices?.[0]?.message?.content ?? "";

      return {
        type: "message",
        content,
        ...(data.usage
          ? { usage: this.#usage(data.usage) }
          : {})
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
      messages: input.messages,
      ...(this.#temperature === undefined ? {} : { temperature: this.#temperature }),
      ...(this.#maxTokens === undefined ? {} : { max_tokens: this.#maxTokens })
    };
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

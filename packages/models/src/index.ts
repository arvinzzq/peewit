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

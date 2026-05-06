import { describe, expect, test } from "vitest";
import {
  AnthropicProvider,
  FakeModelProvider,
  FakeStreamingProvider,
  OpenAICompatibleProvider,
  isStreamingProvider,
  type AnthropicStreamClientLike,
  type ModelInput,
  type ModelOutput,
  type ModelProvider,
  type StreamEvent
} from "./index.js";

describe("model provider contract", () => {
  test("fake provider returns queued assistant messages", async () => {
    const provider: ModelProvider = new FakeModelProvider([
      {
        type: "message",
        content: "Hello from the fake model."
      }
    ]);
    const input: ModelInput = {
      messages: [
        { role: "system", content: "You are Peewit." },
        { role: "user", content: "Say hello." }
      ],
      options: {
        model: "fake-model",
        temperature: 0.2,
        maxTokens: 128
      }
    };

    const expected: ModelOutput = {
      type: "message",
      content: "Hello from the fake model."
    };

    await expect(provider.generate(input)).resolves.toEqual(expected);
  });

  test("fake provider records requests for runtime tests", async () => {
    const provider = new FakeModelProvider([
      {
        type: "message",
        content: "Recorded."
      }
    ]);
    const input: ModelInput = {
      messages: [{ role: "user", content: "Record this." }]
    };

    await provider.generate(input);

    expect(provider.requests).toEqual([input]);
  });

  test("fake provider can simulate normalized provider failures", async () => {
    const provider = new FakeModelProvider([
      {
        type: "error",
        category: "network",
        message: "Network unavailable.",
        recoverable: true
      }
    ]);

    const expected: ModelOutput = {
      type: "error",
      category: "network",
      message: "Network unavailable.",
      recoverable: true
    };

    await expect(provider.generate({ messages: [] })).resolves.toEqual(expected);
  });
});

describe("OpenAI-compatible provider", () => {
  test("posts chat completions requests and normalizes assistant text", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1/",
      apiKey: "secret-key",
      model: "example-model",
      temperature: 0.2,
      maxTokens: 128,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Hello from OpenAI-compatible JSON."
                },
                finish_reason: "stop"
              }
            ],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 5,
              total_tokens: 8
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    });

    const output = await provider.generate({
      messages: [{ role: "user", content: "Hello" }]
    });

    expect(output).toEqual<ModelOutput>({
      type: "message",
      content: "Hello from OpenAI-compatible JSON.",
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8
      }
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/v1/chat/completions");
    expect(requests[0]?.init.method).toBe("POST");
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer secret-key",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      model: "example-model",
      temperature: 0.2,
      max_tokens: 128,
      messages: [{ role: "user", content: "Hello" }]
    });
  });

  test("sends tool definitions in request body when tools are provided", async () => {
    const requests: Array<{ body: unknown }> = [];
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "secret-key",
      model: "example-model",
      fetch: async (_url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generate({
      messages: [{ role: "user", content: "Read a file." }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a workspace file.",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
          }
        }
      ]
    });

    expect(requests[0]?.body).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a workspace file."
          }
        }
      ]
    });
  });

  test("parses tool_calls response as ModelToolCallsOutput", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "secret-key",
      model: "example-model",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_abc",
                      type: "function",
                      function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const output = await provider.generate({ messages: [{ role: "user", content: "Read the file." }] });

    expect(output).toMatchObject({
      type: "tool_calls",
      calls: [{ id: "call_abc", name: "read_file", input: { path: "README.md" } }]
    });
  });

  test("formats tool result messages with tool_call_id in request body", async () => {
    const requests: Array<{ body: unknown }> = [];
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "secret-key",
      model: "example-model",
      fetch: async (_url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Done." } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generate({
      messages: [
        { role: "user", content: "Read a file." },
        { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", input: { path: "README.md" } }] },
        { role: "tool", toolCallId: "call_1", content: "{\"ok\":true}" }
      ]
    });

    const sentMessages = (requests[0]?.body as { messages: unknown[] }).messages;
    expect(sentMessages[1]).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "call_1" }] });
    expect(sentMessages[2]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" });
  });

  test("normalizes authentication failures without exposing the API key", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "secret-key",
      model: "example-model",
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "Bad API key: secret-key" } }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
    });

    const output = await provider.generate({
      messages: [{ role: "user", content: "Hello" }]
    });

    expect(output).toEqual<ModelOutput>({
      type: "error",
      category: "authentication",
      message: "Provider request failed with status 401.",
      recoverable: false
    });
  });
});

// ─── Anthropic Provider ───────────────────────────────────────────────────

type AnthropicFakeRequest = {
  model: string;
  max_tokens: number;
  system?: Array<{ type: string; text?: string; cache_control?: unknown }>;
  messages: unknown[];
  tools?: unknown[];
  temperature?: number;
  thinking?: { type: string; budget_tokens?: number };
};

type AnthropicFakeResponse = {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

function fakeAnthropicClient(response: AnthropicFakeResponse, captured: AnthropicFakeRequest[] = []) {
  return {
    messages: {
      create: async (params: AnthropicFakeRequest) => {
        captured.push(params);
        return response;
      }
    }
  };
}

describe("AnthropicProvider", () => {
  test("extracts system message and sends it as the system parameter", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Hello." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
        captured
      )
    });

    await provider.generate({
      messages: [
        { role: "system", content: "You are Peewit." },
        { role: "user", content: "Hello." }
      ]
    });

    expect(captured[0]?.system).toEqual([
      { type: "text", text: "You are Peewit.", cache_control: { type: "ephemeral" } }
    ]);
    expect(captured[0]?.messages).toEqual([{ role: "user", content: "Hello." }]);
  });

  test("returns text response as ModelMessageOutput with usage", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient({
        content: [{ type: "text", text: "Hello from Anthropic." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 8 }
      })
    });

    const output = await provider.generate({
      messages: [{ role: "user", content: "Hello." }]
    });

    expect(output).toEqual<ModelOutput>({
      type: "message",
      content: "Hello from Anthropic.",
      usage: { inputTokens: 12, outputTokens: 8 }
    });
  });

  test("parses tool_use blocks as ModelToolCallsOutput", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient({
        content: [{ type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "README.md" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 15 }
      })
    });

    const output = await provider.generate({
      messages: [{ role: "user", content: "Read the README." }]
    });

    expect(output).toEqual<ModelOutput>({
      type: "tool_calls",
      calls: [{ id: "toolu_01", name: "read_file", input: { path: "README.md" } }],
      usage: { inputTokens: 20, outputTokens: 15 }
    });
  });

  test("translates tool definitions to Anthropic input_schema format", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "OK." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } },
        captured
      )
    });

    await provider.generate({
      messages: [{ role: "user", content: "Use a tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a workspace file.",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
          }
        }
      ]
    });

    expect(captured[0]?.tools).toEqual([
      {
        name: "read_file",
        description: "Read a workspace file.",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"]
        }
      }
    ]);
  });

  test("groups consecutive tool messages into one user message with tool_result blocks", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 5 } },
        captured
      )
    });

    await provider.generate({
      messages: [
        { role: "user", content: "Read two files." },
        { role: "assistant", content: null, toolCalls: [
          { id: "tc_1", name: "read_file", input: { path: "a.txt" } },
          { id: "tc_2", name: "read_file", input: { path: "b.txt" } }
        ]},
        { role: "tool", toolCallId: "tc_1", content: '{"ok":true,"content":"first"}' },
        { role: "tool", toolCallId: "tc_2", content: '{"ok":true,"content":"second"}' }
      ]
    });

    const msgs = captured[0]?.messages as Array<{ role: string; content: unknown }> | undefined;
    // Two consecutive tool messages → one user message with two tool_result blocks
    expect(msgs).toHaveLength(3);
    expect(msgs?.[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: '{"ok":true,"content":"first"}' },
        { type: "tool_result", tool_use_id: "tc_2", content: '{"ok":true,"content":"second"}' }
      ]
    });
  });

  test("translates assistant tool_calls to tool_use content blocks", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 3 } },
        captured
      )
    });

    await provider.generate({
      messages: [
        { role: "assistant", content: null, toolCalls: [{ id: "tc_1", name: "read_file", input: { path: "a.txt" } }] },
        { role: "tool", toolCallId: "tc_1", content: "result" }
      ]
    });

    const msgs = captured[0]?.messages as Array<{ role: string; content: unknown }> | undefined;
    expect(msgs?.[0]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "tc_1", name: "read_file", input: { path: "a.txt" } }]
    });
  });

  test("normalizes authentication error (401)", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: {
        messages: {
          create: async () => { throw Object.assign(new Error("Unauthorized."), { status: 401 }); }
        }
      }
    });

    const output = await provider.generate({ messages: [{ role: "user", content: "Hi." }] });

    expect(output).toEqual<ModelOutput>({
      type: "error",
      category: "authentication",
      message: "Unauthorized.",
      recoverable: false
    });
  });

  test("normalizes rate limit error (429) as recoverable", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: {
        messages: {
          create: async () => { throw Object.assign(new Error("Rate limited."), { status: 429 }); }
        }
      }
    });

    const output = await provider.generate({ messages: [{ role: "user", content: "Hi." }] });

    expect(output).toEqual<ModelOutput>({
      type: "error",
      category: "rate_limit",
      message: "Rate limited.",
      recoverable: true
    });
  });

  test("normalizes network error when client throws without status", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: {
        messages: {
          create: async () => { throw new Error("Connection refused."); }
        }
      }
    });

    const output = await provider.generate({ messages: [{ role: "user", content: "Hi." }] });

    expect(output).toEqual<ModelOutput>({
      type: "error",
      category: "network",
      message: "Provider network request failed.",
      recoverable: true
    });
  });
});

// ─── isStreamingProvider ──────────────────────────────────────────────────────

describe("isStreamingProvider", () => {
  test("returns true for FakeStreamingProvider", () => {
    const provider = new FakeStreamingProvider([["Hello"]]);
    expect(isStreamingProvider(provider)).toBe(true);
  });

  test("returns true for OpenAICompatibleProvider", () => {
    const provider = new OpenAICompatibleProvider({ baseURL: "https://example.test/v1", model: "m", fetch: async () => new Response("") });
    expect(isStreamingProvider(provider)).toBe(true);
  });

  test("returns true for AnthropicProvider", () => {
    const provider = new AnthropicProvider({ model: "m", client: { messages: { create: async () => ({ content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }) } } });
    expect(isStreamingProvider(provider)).toBe(true);
  });

  test("returns false for FakeModelProvider", () => {
    const provider = new FakeModelProvider([]);
    expect(isStreamingProvider(provider)).toBe(false);
  });
});

// ─── FakeStreamingProvider ────────────────────────────────────────────────────

describe("FakeStreamingProvider", () => {
  test("streams token deltas and message_done for text sequences", async () => {
    const provider = new FakeStreamingProvider([["Hello", " ", "world"]]);
    const events: StreamEvent[] = [];

    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Hi." }] })) {
      events.push(event);
    }

    expect(events).toEqual<StreamEvent[]>([
      { type: "token_delta", delta: "Hello" },
      { type: "token_delta", delta: " " },
      { type: "token_delta", delta: "world" },
      { type: "message_done", content: "Hello world" }
    ]);
  });

  test("emits tool_calls event for tool call sequences", async () => {
    const provider = new FakeStreamingProvider([[{ id: "tc_1", name: "read_file", input: { path: "a.txt" } }]]);
    const events: StreamEvent[] = [];

    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Read." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "tool_calls", calls: [{ id: "tc_1", name: "read_file", input: { path: "a.txt" } }] }
    ]);
  });

  test("emits error when no sequences queued", async () => {
    const provider = new FakeStreamingProvider([]);
    const events: StreamEvent[] = [];

    for await (const event of provider.generateStream({ messages: [] })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: "error" });
  });
});

// ─── OpenAI streaming ─────────────────────────────────────────────────────────

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("OpenAICompatibleProvider streaming", () => {
  test("emits token_delta events and message_done for text response", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "key",
      model: "m",
      fetch: async () =>
        makeSseResponse([
          'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
          'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
          "data: [DONE]\n"
        ])
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Hi." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "token_delta", delta: "Hello" },
      { type: "token_delta", delta: " world" },
      { type: "message_done", content: "Hello world" }
    ]);
  });

  test("emits tool_calls event for tool_calls finish reason", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      apiKey: "key",
      model: "m",
      fetch: async () =>
        makeSseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n',
          "data: [DONE]\n"
        ])
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Read." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "tool_calls", calls: [{ id: "call_1", name: "read_file", input: { path: "a.txt" } }] }
    ]);
  });

  test("emits error event for non-OK HTTP status", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: "https://api.example.test/v1",
      model: "m",
      fetch: async () => new Response("Unauthorized", { status: 401 })
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [] })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: "error", category: "authentication" });
  });
});

// ─── Anthropic streaming ──────────────────────────────────────────────────────

function fakeAnthropicStreamClient(events: Array<{
  type: string;
  [key: string]: unknown;
}>): AnthropicStreamClientLike {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          for (const event of events) {
            yield event as Parameters<typeof fakeAnthropicStreamClient>[0][number];
          }
        })() as unknown as AsyncIterable<never>
    }
  };
}

describe("AnthropicProvider streaming", () => {
  test("emits token_delta events and message_done for text response", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      streamClient: fakeAnthropicStreamClient([
        { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Anthropic" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
        { type: "message_stop" }
      ])
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Hi." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "token_delta", delta: "Hello" },
      { type: "token_delta", delta: " Anthropic" },
      { type: "message_done", content: "Hello Anthropic", usage: { inputTokens: 10, outputTokens: 5 } }
    ]);
  });

  test("emits tool_calls for tool_use stop reason", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      streamClient: fakeAnthropicStreamClient([
        { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path"' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"a.txt"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 } },
        { type: "message_stop" }
      ])
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Read." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "tool_calls", calls: [{ id: "toolu_1", name: "read_file", input: { path: "a.txt" } }] }
    ]);
  });

  test("falls back to non-streaming when streamClient is not provided", async () => {
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Fallback text." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }
      )
    });

    const events: StreamEvent[] = [];
    for await (const event of provider.generateStream({ messages: [{ role: "user", content: "Hi." }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: "token_delta", delta: "Fallback text." },
      { type: "message_done", content: "Fallback text." }
    ]);
  });

  test("AnthropicProvider passes thinking param when budget is medium", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      thinkingBudget: "medium",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Thinking done." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } },
        captured
      )
    });

    await provider.generate({ messages: [{ role: "user", content: "Think hard." }] });

    expect(captured[0]).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 4096 }
    });
  });

  test("AnthropicProvider omits thinking param when budget is off", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      thinkingBudget: "off",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "No thinking." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } },
        captured
      )
    });

    await provider.generate({ messages: [{ role: "user", content: "Go." }] });

    expect(captured[0]).not.toHaveProperty("thinking");
  });

  test("AnthropicProvider passes adaptive thinking param when budget is adaptive", async () => {
    const captured: AnthropicFakeRequest[] = [];
    const provider = new AnthropicProvider({
      model: "claude-opus-4-7",
      thinkingBudget: "adaptive",
      client: fakeAnthropicClient(
        { content: [{ type: "text", text: "Adaptive." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } },
        captured
      )
    });

    await provider.generate({ messages: [{ role: "user", content: "Go." }] });

    expect(captured[0]).toMatchObject({
      thinking: { type: "adaptive" }
    });
  });
});

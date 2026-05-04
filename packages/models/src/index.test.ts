import { describe, expect, test } from "vitest";
import {
  FakeModelProvider,
  OpenAICompatibleProvider,
  type ModelInput,
  type ModelOutput,
  type ModelProvider
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
        { role: "system", content: "You are ArvinClaw." },
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

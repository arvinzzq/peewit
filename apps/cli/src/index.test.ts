import { describe, expect, test } from "vitest";
import { CliChatSession, renderCompactTrace, runCli } from "./index.js";

describe("runCli", () => {
  test("renders help", async () => {
    await expect(runCli(["--help"], "0.0.0")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: expect.stringContaining("Usage: arvinclaw")
    });
  });

  test("renders version", async () => {
    await expect(runCli(["--version"], "0.1.0")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "0.1.0\n"
    });
  });

  test("reports missing API key before starting the configured interactive chat loop", async () => {
    const result = await runCli(["chat"], "0.0.0", {
      env: {},
      readLine: async () => "Hello real provider"
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ARVINCLAW_API_KEY");
    expect(result.stderr).toContain("OPENROUTER_API_KEY");
  });

  test("runs an interactive configured-provider chat loop", async () => {
    const inputs = ["Hello configured", "/exit"];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await runCli(["chat"], "0.0.0", {
      env: {
        ARVINCLAW_API_KEY: "secret-api-key",
        ARVINCLAW_BASE_URL: "https://provider.example/v1",
        ARVINCLAW_MODEL: "test-model"
      },
      readLine: async () => inputs.shift(),
      fetch: async (url, init) => {
        requests.push({
          url,
          ...(init ? { init } : {})
        });

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Configured provider response"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ArvinClaw chat");
    expect(result.stdout).toContain("Assistant: Configured provider response");
    expect(result.stdout).toContain("Goodbye.");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://provider.example/v1/chat/completions");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer secret-api-key"
    });
    expect(requests[0]?.init?.body).toContain("\"model\":\"test-model\"");
  });

  test("sends recent session messages on later interactive turns", async () => {
    const inputs = ["First message", "Second message", "/exit"];
    const requests: Array<{ body: string }> = [];
    const result = await runCli(["chat"], "0.0.0", {
      env: {
        ARVINCLAW_API_KEY: "secret-api-key"
      },
      readLine: async () => inputs.shift(),
      fetch: async (_url, init) => {
        requests.push({
          body: String(init?.body)
        });

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `Response ${requests.length}`
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Assistant: Response 1");
    expect(result.stdout).toContain("Assistant: Response 2");
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      messages: [
        {
          role: "system"
        },
        {
          role: "user",
          content: "First message"
        },
        {
          role: "assistant",
          content: "Response 1"
        },
        {
          role: "user",
          content: "Second message"
        }
      ]
    });
  });

  test("runs an interactive fake-provider chat loop", async () => {
    const inputs = ["Hello interactive", "/exit"];
    const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
      readLine: async () => inputs.shift()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ArvinClaw chat");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello interactive");
    expect(result.stdout).toContain("Goodbye.");
  });

  test("runs slash trace inside an interactive chat loop", async () => {
    const inputs = ["Hello trace", "/trace", "/exit"];
    const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
      readLine: async () => inputs.shift()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Recent Trace:");
    expect(result.stdout).toContain("1. Received user message (run_started)");
    expect(result.stdout).toContain("6. Completed run (run_completed)");
  });

  test("runs a fake-provider chat turn through the runtime", async () => {
    const result = await runCli(["chat", "--fake", "Hello runtime"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello runtime");
    expect(result.stdout).toContain("Trace:");
    expect(result.stdout).toContain("1. Received user message");
    expect(result.stdout).toContain("5. Created assistant message");
    expect(result.stdout).toContain("6. Completed run");
  });

  test("runs slash trace after a fake-provider chat turn in the same CLI run", async () => {
    const result = await runCli(["chat", "--fake", "Hello runtime", "/trace"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello runtime");
    expect(result.stdout).toContain("Recent Trace:");
    expect(result.stdout).toContain("1. Received user message (run_started)");
    expect(result.stdout).toContain("6. Completed run (run_completed)");
  });

  test("runs slash config with redacted config after a fake-provider chat turn", async () => {
    const result = await runCli(
      ["chat", "--fake", "Hello runtime", "/config"],
      "0.0.0",
      {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key"
        }
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Config:");
    expect(result.stdout).toContain("Provider: openai-compatible");
    expect(result.stdout).toContain("Model: gpt-4.1-mini");
    expect(result.stdout).toContain("Default mode: confirm");
    expect(result.stdout).toContain("API key: configured");
    expect(result.stdout).not.toContain("secret-api-key");
  });

  test("chat session can return recent trace through slash command", async () => {
    const session = CliChatSession.createFake();

    await session.sendMessage("Hello trace");

    expect(await session.runSlashCommand("/trace")).toEqual([
      "1. Received user message (run_started)",
      "2. Assembled context (context_assembled)",
      "3. Started model request (model_request_started)",
      "4. Completed model request (model_request_completed)",
      "5. Created assistant message (assistant_message_created)",
      "6. Completed run (run_completed)"
    ]);
  });

  test("chat session can return redacted config through slash command", async () => {
    const session = CliChatSession.createFake("Fake response", {
      env: {
        ARVINCLAW_API_KEY: "secret-api-key"
      }
    });

    expect(await session.runSlashCommand("/config")).toEqual([
      "Provider: openai-compatible",
      "Model: gpt-4.1-mini",
      "Base URL: https://api.openai.com/v1",
      "Default mode: confirm",
      "Trace verbosity: explainable",
      "API key: configured"
    ]);
  });

  test("renders compact trace lines for successful runtime events", () => {
    expect(
      renderCompactTrace([
        {
          type: "run_started",
          eventId: "evt_1",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.000Z",
          userMessage: "Hello"
        },
        {
          type: "run_completed",
          eventId: "evt_2",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:01.000Z"
        }
      ])
    ).toEqual(["1. Received user message (run_started)", "2. Completed run (run_completed)"]);
  });

  test("reports unknown commands without crashing", async () => {
    const result = await runCli(["unknown"], "0.0.0");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "unknown"');
    expect(result.stdout).toContain("Usage: arvinclaw");
  });
});

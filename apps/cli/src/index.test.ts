import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const inputs = ["Hello configured", "/exit"];
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          ARVINCLAW_BASE_URL: "https://provider.example/v1",
          ARVINCLAW_MODEL: "test-model"
        },
        sessionsDirectory: directory,
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
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("includes workspace prompt files in configured-provider chat context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-cli-workspace-"));
    const inputs = ["Follow workspace guidance", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await writeFile(join(workspace, "AGENTS.md"), "Always explain architectural intent.");
      await writeFile(join(workspace, "SOUL.md"), "Be calm and direct.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          ARVINCLAW_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({
            body: String(init?.body)
          });

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Workspace-aware response" } }]
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
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("### AGENTS.md");
      expect(body.messages[0].content).toContain("Always explain architectural intent.");
      expect(body.messages[0].content).toContain("### SOUL.md");
      expect(body.messages[0].content).toContain("Be calm and direct.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("includes read-only long-term memory files when enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-cli-workspace-"));
    const inputs = ["Use long-term memory", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await writeFile(join(workspace, "USER.md"), "User prefers concise architecture notes.");
      await writeFile(join(workspace, "MEMORY.md"), "ArvinClaw Phase 5 is about memory.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          ARVINCLAW_WORKSPACE_ROOT: workspace,
          ARVINCLAW_LONG_TERM_MEMORY: "read-only"
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({
            body: String(init?.body)
          });

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Memory-aware response" } }]
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
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).toContain("### USER.md");
      expect(body.messages[0].content).toContain("User prefers concise architecture notes.");
      expect(body.messages[0].content).toContain("### MEMORY.md");
      expect(body.messages[0].content).toContain("ArvinClaw Phase 5 is about memory.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("includes today and yesterday daily memory files when read-only memory is enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-cli-workspace-"));
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const inputs = ["Use daily memory", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await mkdir(join(workspace, "memory"));
      await writeFile(join(workspace, "memory", `${today}.md`), "Today we are working on daily memory.");
      await writeFile(join(workspace, "memory", `${yesterday}.md`), "Yesterday we finished read-only memory.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          ARVINCLAW_WORKSPACE_ROOT: workspace,
          ARVINCLAW_LONG_TERM_MEMORY: "read-only"
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({
            body: String(init?.body)
          });

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Daily memory response" } }]
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
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).toContain(`### memory/${today}.md`);
      expect(body.messages[0].content).toContain("Today we are working on daily memory.");
      expect(body.messages[0].content).toContain(`### memory/${yesterday}.md`);
      expect(body.messages[0].content).toContain("Yesterday we finished read-only memory.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("omits long-term memory files by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-cli-workspace-"));
    const inputs = ["Do not use long-term memory", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      const today = new Date().toISOString().slice(0, 10);

      await writeFile(join(workspace, "USER.md"), "This should not be loaded by default.");
      await writeFile(join(workspace, "MEMORY.md"), "This should also stay out.");
      await mkdir(join(workspace, "memory"));
      await writeFile(join(workspace, "memory", `${today}.md`), "Daily memory should stay out.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          ARVINCLAW_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({
            body: String(init?.body)
          });

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Default memory response" } }]
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
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).not.toContain("### USER.md");
      expect(body.messages[0].content).not.toContain("### MEMORY.md");
      expect(body.messages[0].content).not.toContain("### memory/");
      expect(body.messages[0].content).not.toContain("This should not be loaded by default.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("sends recent session messages on later interactive turns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const inputs = ["First message", "Second message", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key"
        },
        sessionsDirectory: directory,
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
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("persists configured chat messages across CLI runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const env = {
      ARVINCLAW_API_KEY: "secret-api-key"
    };

    try {
      const firstInputs = ["First durable message", "/exit"];
      await runCli(["chat", "--session", "durable_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => firstInputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Durable response 1"
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
          )
      });

      const requests: Array<{ body: string }> = [];
      const secondInputs = ["Second durable message", "/exit"];
      const secondResult = await runCli(["chat", "--session", "durable_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => secondInputs.shift(),
        fetch: async (_url, init) => {
          requests.push({
            body: String(init?.body)
          });

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Durable response 2"
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

      expect(secondResult.exitCode).toBe(0);
      expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
        messages: [
          {
            role: "system"
          },
          {
            role: "user",
            content: "First durable message"
          },
          {
            role: "assistant",
            content: "Durable response 1"
          },
          {
            role: "user",
            content: "Second durable message"
          }
        ]
      });
      await expect(readFile(join(directory, "durable_session.jsonl"), "utf8")).resolves.toContain("First durable message");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("persists configured chat trace across CLI runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const env = {
      ARVINCLAW_API_KEY: "secret-api-key"
    };

    try {
      const firstInputs = ["Trace me", "/exit"];
      await runCli(["chat", "--session", "trace_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => firstInputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Trace response"
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
          )
      });

      const secondInputs = ["/trace", "/exit"];
      const secondResult = await runCli(["chat", "--session", "trace_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => secondInputs.shift(),
        fetch: async () => {
          throw new Error("Trace-only run should not call the provider.");
        }
      });

      expect(secondResult.exitCode).toBe(0);
      expect(secondResult.stdout).toContain("Recent Trace:");
      expect(secondResult.stdout).toContain("1. Received user message (run_started)");
      expect(secondResult.stdout).toContain("6. Completed run (run_completed)");
      await expect(readFile(join(directory, "trace_session.jsonl"), "utf8")).resolves.toContain("\"type\":\"trace\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes the most recently updated configured chat session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));
    const env = {
      ARVINCLAW_API_KEY: "secret-api-key"
    };

    try {
      const olderInputs = ["Older message", "/exit"];
      await runCli(["chat", "--session", "older_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => olderInputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Older response" } }]
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          )
      });

      const newerInputs = ["Newer message", "/exit"];
      await runCli(["chat", "--session", "newer_session"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => newerInputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Newer response" } }]
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          )
      });

      const requests: Array<{ body: string }> = [];
      const resumedInputs = ["Resumed message", "/exit"];
      const result = await runCli(["chat", "--resume"], "0.0.0", {
        env,
        sessionsDirectory: directory,
        readLine: async () => resumedInputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Resume response" } }]
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Resumed session: newer_session");
      expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
        messages: [
          { role: "system" },
          { role: "user", content: "Newer message" },
          { role: "assistant", content: "Newer response" },
          { role: "user", content: "Resumed message" }
        ]
      });
      await expect(readFile(join(directory, "newer_session.jsonl"), "utf8")).resolves.toContain("Resumed message");
      await expect(readFile(join(directory, "older_session.jsonl"), "utf8")).resolves.not.toContain("Resumed message");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("reports when chat resume has no stored sessions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));

    try {
      const inputs = ["/exit"];
      const result = await runCli(["chat", "--resume"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key"
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift()
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No stored sessions to resume");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("expands the default sessions directory under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "arvinclaw-cli-home-"));
    const inputs = ["Home session message", "/exit"];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key",
          HOME: home
        },
        readLine: async () => inputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Home session response"
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
          )
      });

      expect(result.exitCode).toBe(0);
      const files = await readdir(join(home, ".arvinclaw", "sessions"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^session_[A-Za-z0-9_-]+\.jsonl$/);
      await expect(readFile(join(home, ".arvinclaw", "sessions", files[0] ?? ""), "utf8")).resolves.toContain("Home session message");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("lists stored sessions from the configured session directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-cli-sessions-"));

    try {
      const firstInputs = ["First list message", "/exit"];
      await runCli(["chat", "--session", "first_session"], "0.0.0", {
        env: {
          ARVINCLAW_API_KEY: "secret-api-key"
        },
        sessionsDirectory: directory,
        readLine: async () => firstInputs.shift(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "First response"
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
          )
      });

      const result = await runCli(["sessions"], "0.0.0", {
        sessionsDirectory: directory
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Sessions:");
      expect(result.stdout).toContain("first_session");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
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
      "Long-term memory files: disabled",
      "Memory writes: disabled",
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

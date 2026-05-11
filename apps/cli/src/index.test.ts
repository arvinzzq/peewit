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
      stdout: expect.stringContaining("Usage: vole")
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
    expect(result.stderr).toContain("VOLE_API_KEY");
    expect(result.stderr).toContain("OPENROUTER_API_KEY");
  });

  test("bare `vole` (no args) defaults to interactive chat", async () => {
    const result = await runCli([], "0.0.0", {
      env: {},
      readLine: async () => undefined
    });

    // No API key → chat rejects before reading any input
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No API key");
  });

  test("runs an interactive configured-provider chat loop", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const inputs = ["Hello configured", "/exit"];
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_BASE_URL: "https://provider.example/v1",
          VOLE_MODEL: "test-model"
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
      expect(result.stdout).toContain("Vole chat");
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
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
    const inputs = ["Follow workspace guidance", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await writeFile(join(workspace, "AGENTS.md"), "Always explain architectural intent.");
      await writeFile(join(workspace, "SOUL.md"), "Be calm and direct.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace
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

  test("always loads USER.md and MEMORY.md when present in workspace", async () => {
    // OpenClaw alignment: USER.md and MEMORY.md are part of the standard bootstrap
    // file list and are loaded whenever they exist, regardless of memory config.
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
    const inputs = ["Tell me about memory", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await writeFile(join(workspace, "USER.md"), "User prefers concise architecture notes.");
      await writeFile(join(workspace, "MEMORY.md"), "Vole Phase 5 is about memory.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Memory-aware response" } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).toContain("### USER.md");
      expect(body.messages[0].content).toContain("User prefers concise architecture notes.");
      expect(body.messages[0].content).toContain("### MEMORY.md");
      expect(body.messages[0].content).toContain("Vole Phase 5 is about memory.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("does not inject daily memory files into bootstrap context", async () => {
    // OpenClaw alignment: daily files (memory/YYYY-MM-DD.md) are accessed through
    // memory tools (memory_search, memory_get), not injected at bootstrap time.
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
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
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace,
          VOLE_LONG_TERM_MEMORY: "read-only"
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Daily memory response" } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).not.toContain(`### memory/${today}.md`);
      expect(body.messages[0].content).not.toContain(`### memory/${yesterday}.md`);
      expect(body.messages[0].content).not.toContain("Today we are working on daily memory.");
      expect(body.messages[0].content).not.toContain("Yesterday we finished read-only memory.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("daily memory files are never injected into bootstrap regardless of memory config", async () => {
    // Ensure that even with files present, daily notes stay out of system prompt.
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
    const inputs = ["Hello", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      const today = new Date().toISOString().slice(0, 10);
      await mkdir(join(workspace, "memory"));
      await writeFile(join(workspace, "memory", `${today}.md`), "Daily memory should stay out.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Response" } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).not.toContain("### memory/");
      expect(body.messages[0].content).not.toContain("Daily memory should stay out.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("includes TOOLS.md in workspace prompt files when present", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
    const inputs = ["Use tool notes", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      await writeFile(join(workspace, "TOOLS.md"), "Tool environment notes go here.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Tools-aware response" } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).toContain("### TOOLS.md");
      expect(body.messages[0].content).toContain("Tool environment notes go here.");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("skips missing workspace files gracefully", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-workspace-"));
    const inputs = ["No extra files", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      // workspace has no HEARTBEAT.md, TOOLS.md, IDENTITY.md, or BOOTSTRAP.md
      await writeFile(join(workspace, "AGENTS.md"), "Base agent instructions.");

      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          VOLE_WORKSPACE_ROOT: workspace
        },
        sessionsDirectory: directory,
        readLine: async () => inputs.shift(),
        fetch: async (_url, init) => {
          requests.push({ body: String(init?.body) });
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Graceful response" } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(requests[0]?.body ?? "{}");
      expect(body.messages[0].content).not.toContain("### HEARTBEAT.md");
      expect(body.messages[0].content).not.toContain("### TOOLS.md");
      expect(body.messages[0].content).not.toContain("### IDENTITY.md");
      expect(body.messages[0].content).not.toContain("### BOOTSTRAP.md");
      expect(body.messages[0].content).toContain("### AGENTS.md");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("sends recent session messages on later interactive turns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const inputs = ["First message", "Second message", "/exit"];
    const requests: Array<{ body: string }> = [];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key"
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
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const env = {
      VOLE_API_KEY: "secret-api-key"
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
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const env = {
      VOLE_API_KEY: "secret-api-key"
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
      expect(secondResult.stdout).toContain("7. Completed run (run_completed)");
      await expect(readFile(join(directory, "trace_session.jsonl"), "utf8")).resolves.toContain("\"type\":\"trace\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes the most recently updated configured chat session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const env = {
      VOLE_API_KEY: "secret-api-key"
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
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));

    try {
      const inputs = ["/exit"];
      const result = await runCli(["chat", "--resume"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key"
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
    const home = await mkdtemp(join(tmpdir(), "vole-cli-home-"));
    const inputs = ["Home session message", "/exit"];

    try {
      const result = await runCli(["chat"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key",
          HOME: home
        },
        cwd: home,
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
      const files = await readdir(join(home, ".vole", "sessions"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^session_[A-Za-z0-9_-]+\.jsonl$/);
      await expect(readFile(join(home, ".vole", "sessions", files[0] ?? ""), "utf8")).resolves.toContain("Home session message");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("lists stored sessions from the configured session directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));

    try {
      const firstInputs = ["First list message", "/exit"];
      await runCli(["chat", "--session", "first_session"], "0.0.0", {
        env: {
          VOLE_API_KEY: "secret-api-key"
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
    expect(result.stdout).toContain("Vole chat");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello interactive");
    expect(result.stdout).toContain("Goodbye.");
  });

  test("prompts for approval when an interactive fake-provider turn requests an ask-level tool call", async () => {
    const inputs = ["Write a file", "n", "/exit"];
    const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
      fakeModelOutputs: [
        {
          type: "tool_calls",
          calls: [
            {
              id: "call_1",
              name: "write_file",
              input: { path: "output.txt", content: "hello" }
            }
          ]
        }
      ],
      readLine: async () => inputs.shift()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Approval required:");
    expect(result.stdout).toContain("Tool: write_file");
    expect(result.stdout).toContain("Risk: medium");
    expect(result.stdout).toContain("Reason: Medium and high-risk actions require approval in confirm mode.");
    expect(result.stdout).toContain("Decision: denied");
  });

  test("executes built-in read-only file tools in the fake interactive chat loop", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-cli-tool-workspace-"));
    await writeFile(join(workspace, "README.md"), "CLI tool observation.");
    const inputs = ["Read README", "/trace", "/exit"];

    try {
      const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
        env: {
          VOLE_WORKSPACE_ROOT: workspace
        },
        fakeModelOutputs: [
          {
            type: "tool_calls",
            calls: [
              {
                id: "call_read",
                name: "read_file",
                input: {
                  path: "README.md"
                }
              }
            ]
          },
          {
            type: "message",
            content: "Read README through the built-in file tool."
          }
        ],
        readLine: async () => inputs.shift()
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Assistant: Read README through the built-in file tool.");
      expect(result.stdout).toContain("tool_started)");
      expect(result.stdout).toContain("tool_completed)");
      expect(result.stdout).toContain("13. Completed run (run_completed)");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("executes built-in web page tool in the fake interactive chat loop", async () => {
    const inputs = ["Read example.com", "/trace", "/exit"];

    try {
      const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
        fakeModelOutputs: [
          {
            type: "tool_calls",
            calls: [
              {
                id: "call_web",
                name: "read_web_page",
                input: { url: "https://example.com" }
              }
            ]
          },
          {
            type: "message",
            content: "Read the web page content."
          }
        ],
        readLine: async () => inputs.shift(),
        fetch: async (url) => {
          if (url === "https://example.com") {
            return new Response(
              "<html><body><h1>Example Domain</h1><p>For illustrative examples.</p></body></html>",
              { status: 200, headers: { "content-type": "text/html" } }
            );
          }
          throw new Error(`Unexpected fetch call: ${url}`);
        }
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Assistant: Read the web page content.");
      expect(result.stdout).toContain("tool_started)");
      expect(result.stdout).toContain("tool_completed)");
      expect(result.stdout).toContain("13. Completed run (run_completed)");
    } finally {
      // no cleanup needed; no temp files created
    }
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
    expect(result.stdout).toContain("7. Completed run (run_completed)");
  });

  test("runs a fake-provider chat turn through the runtime", async () => {
    const result = await runCli(["chat", "--fake", "Hello runtime"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello runtime");
    expect(result.stdout).toContain("Trace:");
    expect(result.stdout).toContain("1. Received user message");
    expect(result.stdout).toContain("5. Created assistant message");
    expect(result.stdout).toContain("7. Completed run");
  });

  test("runs slash trace after a fake-provider chat turn in the same CLI run", async () => {
    const result = await runCli(["chat", "--fake", "Hello runtime", "/trace"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Assistant: Fake response to: Hello runtime");
    expect(result.stdout).toContain("Recent Trace:");
    expect(result.stdout).toContain("1. Received user message (run_started)");
    expect(result.stdout).toContain("7. Completed run (run_completed)");
  });

  test("runs slash config with redacted config after a fake-provider chat turn", async () => {
    const result = await runCli(
      ["chat", "--fake", "Hello runtime", "/config"],
      "0.0.0",
      {
        env: {
          VOLE_API_KEY: "secret-api-key"
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

  test("runs slash help inside an interactive chat loop", async () => {
    const inputs = ["/help", "/exit"];
    const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
      readLine: async () => inputs.shift()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("/trace");
    expect(result.stdout).toContain("/clear");
    expect(result.stdout).toContain("/exit");
  });

  test("runs slash clear inside an interactive chat loop", async () => {
    const inputs = ["Hello", "/clear", "/exit"];
    const result = await runCli(["chat", "--fake-interactive"], "0.0.0", {
      readLine: async () => inputs.shift()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("(conversation display cleared)");
  });

  test("runs slash help after a fake-provider chat turn in the same CLI run", async () => {
    const result = await runCli(["chat", "--fake", "Hello runtime", "/help"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("/trace");
    expect(result.stdout).toContain("/clear");
  });

  test("chat session can return help through slash command", async () => {
    const session = await CliChatSession.createFake();

    expect(await session.runSlashCommand("/help")).toEqual([
      "Commands:",
      "/help    Show commands",
      "/trace   Show recent trace events",
      "/config  Show redacted configuration",
      "/skills  List loaded skills",
      "/clear   Clear conversation display",
      "/exit    Leave chat"
    ]);
  });

  test("chat session returns unknown slash command message for unrecognised commands", async () => {
    const session = await CliChatSession.createFake();

    expect(await session.runSlashCommand("/bogus")).toEqual([
      "Unknown slash command: /bogus"
    ]);
  });

  test("chat session can return recent trace through slash command", async () => {
    const session = await CliChatSession.createFake();

    await session.sendMessage("Hello trace");

    expect(await session.runSlashCommand("/trace")).toEqual([
      "1. Received user message (run_started)",
      "2. Assembled context (context_assembled)",
      "3. Started model request (model_request_started)",
      "4. Completed model request (model_request_completed)",
      "5. Created assistant message (assistant_message_created)",
      "6. Turn complete (2 messages) (turn_complete)",
      "7. Completed run (run_completed)"
    ]);
  });

  test("chat session can return redacted config through slash command", async () => {
    const session = await CliChatSession.createFake("Fake response", {
      env: {
        VOLE_API_KEY: "secret-api-key"
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
          type: "tool_call_requested",
          eventId: "evt_tool",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.500Z",
          call: {
            id: "call_1",
            name: "read_file",
            input: {
              path: "README.md"
            }
          }
        },
        {
          type: "tool_call_permission_evaluated",
          eventId: "evt_permission",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.600Z",
          callId: "call_1",
          toolName: "read_file",
          decision: {
            decision: "ask",
            risk: "medium",
            reason: "Medium and high-risk actions require approval in confirm mode."
          }
        },
        {
          type: "approval_requested",
          eventId: "evt_approval_request",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.700Z",
          callId: "call_1",
          toolName: "read_file",
          decision: {
            decision: "ask",
            risk: "medium",
            reason: "Medium and high-risk actions require approval in confirm mode."
          }
        },
        {
          type: "approval_resolved",
          eventId: "evt_approval_resolved",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.800Z",
          callId: "call_1",
          toolName: "read_file",
          resolution: {
            approved: false,
            reason: "Denied from CLI prompt."
          }
        },
        {
          type: "tool_started",
          eventId: "evt_tool_started",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.900Z",
          callId: "call_1",
          toolName: "read_file"
        },
        {
          type: "tool_completed",
          eventId: "evt_tool_completed",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.950Z",
          callId: "call_1",
          toolName: "read_file",
          result: {
            ok: true,
            content: "Hello",
            summary: "Read file README.md."
          }
        },
        {
          type: "tool_failed",
          eventId: "evt_tool_failed",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:00.975Z",
          callId: "call_2",
          toolName: "missing_tool",
          error: {
            message: "Tool missing_tool is not registered."
          }
        },
        {
          type: "run_completed",
          eventId: "evt_2",
          runId: "run_1",
          timestamp: "2026-05-03T01:40:01.000Z"
        }
      ])
    ).toEqual([
      "1. Received user message (run_started)",
      "2. Requested tool call (tool_call_requested)",
      "3. Evaluated tool permission (tool_call_permission_evaluated)",
      "4. Requested approval (approval_requested)",
      "5. Resolved approval (approval_resolved)",
      "6. Tool: read_file (tool_started)",
      "7. Result [read_file]:\nHello (tool_completed)",
      "8. Tool failed [missing_tool]: Tool missing_tool is not registered. (tool_failed)",
      "9. Completed run (run_completed)"
    ]);
  });

  test("reports unknown commands without crashing", async () => {
    const result = await runCli(["unknown"], "0.0.0");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "unknown"');
    expect(result.stdout).toContain("Usage: vole");
  });

  test("skills lists built-in skills", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    try {
      const result = await runCli(["skills"], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Skills:");
      expect(result.stdout).toContain("research");
      expect(result.stdout).toContain("built-in");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("skills install installs a skill and prints confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const srcDir = await mkdtemp(join(tmpdir(), "vole-skill-src-"));
    try {
      const srcPath = join(srcDir, "test-skill.md");
      await writeFile(srcPath, "---\nname: test-skill\ndescription: A test skill.\n---\nbody", "utf8");

      const result = await runCli(["skills", "install", srcPath], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Installed: test-skill");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(srcDir, { force: true, recursive: true });
    }
  });

  test("skills disable disables an installed skill", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const srcDir = await mkdtemp(join(tmpdir(), "vole-skill-src-"));
    try {
      const srcPath = join(srcDir, "test-skill.md");
      await writeFile(srcPath, "---\nname: test-skill\ndescription: A test skill.\n---\nbody", "utf8");

      await runCli(["skills", "install", srcPath], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });

      const result = await runCli(["skills", "disable", "test-skill"], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Disabled: test-skill");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(srcDir, { force: true, recursive: true });
    }
  });

  test("skills trust marks an installed skill as trusted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const srcDir = await mkdtemp(join(tmpdir(), "vole-skill-src-"));
    try {
      const srcPath = join(srcDir, "test-skill.md");
      await writeFile(srcPath, "---\nname: test-skill\ndescription: A test skill.\n---\nbody", "utf8");

      await runCli(["skills", "install", srcPath], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });

      const result = await runCli(["skills", "trust", "test-skill"], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Trusted: test-skill");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(srcDir, { force: true, recursive: true });
    }
  });

  test("skills review shows skill metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    const srcDir = await mkdtemp(join(tmpdir(), "vole-skill-src-"));
    try {
      const srcPath = join(srcDir, "test-skill.md");
      await writeFile(srcPath, "---\nname: test-skill\ndescription: A test skill.\nversion: 1.0.0\npermissions: filesystem\n---\nskill body text", "utf8");

      await runCli(["skills", "install", srcPath], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });

      const result = await runCli(["skills", "review", "test-skill"], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Name:         test-skill");
      expect(result.stdout).toContain("Version:      1.0.0");
      expect(result.stdout).toContain("Permissions:  filesystem");
      expect(result.stdout).toContain("Trusted:      false");
      expect(result.stdout).toContain("skill body text");
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(srcDir, { force: true, recursive: true });
    }
  });

  test("skills review returns error for unknown skill", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-cli-sessions-"));
    try {
      const result = await runCli(["skills", "review", "nonexistent"], "0.0.0", {
        env: {},
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("daemon requires API key", async () => {
    const result = await runCli(["daemon", "--once"], "0.0.0", { env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("VOLE_API_KEY");
  });

  test("daemon --once reports missing tasks directory", async () => {
    // Create an isolated parent dir so sessionsDir/tasks does not exist
    const parentDir = await mkdtemp(join(tmpdir(), "vole-daemon-parent-"));
    const directory = join(parentDir, "sessions");
    await mkdir(directory, { recursive: true });
    try {
      const result = await runCli(["daemon", "--once"], "0.0.0", {
        env: { VOLE_API_KEY: "fake-key" },
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No tasks directory found at");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  test("daemon --once runs cron tasks from tasks directory", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "vole-daemon-parent-"));
    const directory = join(parentDir, "sessions");
    await mkdir(directory, { recursive: true });
    try {
      const { dirname: pathDirname } = await import("node:path");
      const tasksDir = join(pathDirname(directory), "tasks");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "morning.task.json"),
        JSON.stringify({ name: "morning-check", goal: "check morning status", cron: "* * * * *" }),
        "utf8"
      );

      const fakeOutputs = [{ type: "message" as const, content: "Morning check done." }];
      const result = await runCli(["daemon", "--once"], "0.0.0", {
        env: { VOLE_API_KEY: "fake-key" },
        sessionsDirectory: directory,
        fakeModelOutputs: fakeOutputs
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("morning-check");
      expect(result.stdout).toContain("Done.");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  test("taskflow list shows no records when empty", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "vole-taskflow-cli-"));
    const directory = join(parentDir, "sessions");
    await mkdir(directory, { recursive: true });
    try {
      const result = await runCli(["taskflow", "list"], "0.0.0", {
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No task records found.");
      expect(result.stderr).toBe("");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  test("taskflow show returns not-found for unknown id", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "vole-taskflow-cli-"));
    const directory = join(parentDir, "sessions");
    await mkdir(directory, { recursive: true });
    try {
      const result = await runCli(["taskflow", "show", "nonexistent_id"], "0.0.0", {
        sessionsDirectory: directory
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("nonexistent_id");
      expect(result.stderr).toContain("not found");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  test("daemon --once skips tasks without cron field", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "vole-daemon-parent-"));
    const directory = join(parentDir, "sessions");
    await mkdir(directory, { recursive: true });
    try {
      const { dirname: pathDirname } = await import("node:path");
      const tasksDir = join(pathDirname(directory), "tasks");
      await mkdir(tasksDir, { recursive: true });
      // Task without a cron field — should be skipped
      await writeFile(
        join(tasksDir, "manual.task.json"),
        JSON.stringify({ name: "manual-task", goal: "run manually" }),
        "utf8"
      );

      const fakeOutputs = [{ type: "message" as const, content: "Should not run." }];
      const result = await runCli(["daemon", "--once"], "0.0.0", {
        env: { VOLE_API_KEY: "fake-key" },
        sessionsDirectory: directory,
        fakeModelOutputs: fakeOutputs
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("manual-task");
      expect(result.stdout).toContain("Done.");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  test("run --dream requires write memory policy", async () => {
    const result = await runCli(["run", "--dream"], "0.0.0", {
      env: {
        VOLE_API_KEY: "fake-key",
        VOLE_MODEL: "test-model"
        // VOLE_LONG_TERM_MEMORY not set → defaults to "disabled"
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("VOLE_LONG_TERM_MEMORY=write");
  });
});

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

  test("keeps interactive chat as a Phase 1 placeholder", async () => {
    const result = await runCli(["chat"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("interactive chat is not wired yet");
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

import { describe, expect, test } from "vitest";
import { runCli } from "./index.js";

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

  test("keeps chat as a Phase 1 placeholder", async () => {
    const result = await runCli(["chat"], "0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("chat is planned for Phase 1");
  });

  test("reports unknown commands without crashing", async () => {
    const result = await runCli(["unknown"], "0.0.0");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "unknown"');
    expect(result.stdout).toContain("Usage: arvinclaw");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DefaultPermissionPolicy,
  DockerSandbox,
  WorkerThreadSandbox,
  WorkspaceSandbox,
  type PermissionPolicy
} from "./index.js";

describe("default permission policy", () => {
  test("auto-allows low-risk actions in confirm mode", () => {
    const policy: PermissionPolicy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "read_file",
          summary: "Read package.json",
          risk: "low"
        }
      })
    ).toEqual({
      decision: "allow",
      risk: "low",
      reason: "Low-risk action is allowed in confirm mode."
    });
  });

  test("asks for medium and high-risk actions in confirm mode", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "write_file",
          summary: "Write README.md",
          risk: "medium"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "medium"
    });
    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "shell",
          summary: "Run pnpm install",
          risk: "high"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "high"
    });
  });

  test("asks for every non-blocked action in observe mode", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "observe",
        action: {
          kind: "tool",
          name: "read_file",
          summary: "Read package.json",
          risk: "low"
        }
      })
    ).toEqual({
      decision: "ask",
      risk: "low",
      reason: "Observe mode asks before external actions."
    });
  });

  test("auto-allows low and medium-risk actions in auto mode but asks for high-risk actions", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "auto",
        action: {
          kind: "tool",
          name: "write_file",
          summary: "Write generated report",
          risk: "medium"
        }
      })
    ).toMatchObject({
      decision: "allow",
      risk: "medium"
    });
    expect(
      policy.evaluate({
        mode: "auto",
        action: {
          kind: "tool",
          name: "shell",
          summary: "Run migration",
          risk: "high"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "high"
    });
  });

  test("denies blocked actions in every mode", () => {
    const policy = new DefaultPermissionPolicy();

    for (const mode of ["observe", "confirm", "auto"] as const) {
      expect(
        policy.evaluate({
          mode,
          action: {
            kind: "tool",
            name: "shell",
            summary: "Delete the workspace",
            risk: "blocked"
          }
        })
      ).toEqual({
        decision: "deny",
        risk: "blocked",
        reason: "Blocked actions are denied."
      });
    }
  });
});

describe("WorkspaceSandbox", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "vole-workspace-sandbox-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test("reports available true and identifies as workspace backend", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    expect(sandbox.name).toBe("workspace");
    await expect(sandbox.available()).resolves.toBe(true);
  });

  test("executes a benign command and captures stdout and exit code", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute({ command: "echo hello-sandbox" });
    expect(result.completed).toBe(true);
    if (result.completed) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello-sandbox");
    }
  });

  test("rejects sandbox-escape commands", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute({ command: "cd / && ls" });
    expect(result).toEqual({
      completed: false,
      reason: "rejected",
      message: "Command rejected: workspace sandbox prevents execution outside workspace."
    });
  });

  test("rejects path-traversal commands", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute({ command: "cat /../etc/passwd" });
    expect(result).toMatchObject({ completed: false, reason: "rejected" });
  });

  test("rejects cwd outside the workspace", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute(
      { command: "pwd" },
      { cwd: "/tmp" }
    );
    expect(result).toMatchObject({
      completed: false,
      reason: "rejected",
      message: "Command rejected: requested cwd is outside the workspace."
    });
  });

  test("accepts a subdirectory cwd inside the workspace", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    await sandbox.execute({ command: "mkdir -p sub" });
    const result = await sandbox.execute({ command: "pwd" }, { cwd: "sub" });
    expect(result.completed).toBe(true);
    if (result.completed) {
      expect(result.stdout).toContain("sub");
    }
  });

  test("surfaces timeout as a non-completed result", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute(
      { command: "sleep 1" },
      { timeoutMs: 50 }
    );
    expect(result).toMatchObject({ completed: false, reason: "timeout" });
  });

  test("propagates non-zero exit codes", async () => {
    const sandbox = new WorkspaceSandbox({ workspaceRoot });
    const result = await sandbox.execute({ command: "exit 7" });
    expect(result.completed).toBe(true);
    if (result.completed) {
      expect(result.exitCode).toBe(7);
    }
  });
});

describe("WorkerThreadSandbox", () => {
  test("reports available true and identifies as worker backend", async () => {
    const sandbox = new WorkerThreadSandbox();
    expect(sandbox.name).toBe("worker");
    await expect(sandbox.available()).resolves.toBe(true);
  });

  test("evaluates a JS expression and returns the result on stdout", async () => {
    const sandbox = new WorkerThreadSandbox();
    const result = await sandbox.execute({ command: "return 2 + 3;" });
    expect(result.completed).toBe(true);
    if (result.completed) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("5");
    }
  });

  test("captures thrown errors as non-zero exit + stderr", async () => {
    const sandbox = new WorkerThreadSandbox();
    const result = await sandbox.execute({ command: "throw new Error('boom');" });
    expect(result.completed).toBe(true);
    if (result.completed) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("boom");
    }
  });

  test("surfaces timeout as a non-completed result", async () => {
    const sandbox = new WorkerThreadSandbox({ defaultTimeoutMs: 50 });
    const result = await sandbox.execute({
      command: "return new Promise((r) => { /* never resolves */ });"
    });
    expect(result).toMatchObject({ completed: false, reason: "timeout" });
  });
});

describe("DockerSandbox", () => {
  test("identifies as docker backend", () => {
    const sandbox = new DockerSandbox({ workspaceRoot: "/tmp" });
    expect(sandbox.name).toBe("docker");
  });

  test("execute returns unavailable when Docker is not installed", async () => {
    // The test environment is not guaranteed to have Docker. If the daemon is
    // reachable, this test asserts the happy path; otherwise it asserts the
    // unavailable degradation. Both are valid outcomes for the same code path.
    const sandbox = new DockerSandbox({ workspaceRoot: "/tmp", defaultTimeoutMs: 2_000 });
    const available = await sandbox.available();
    if (!available) {
      const result = await sandbox.execute({ command: "true" });
      expect(result).toMatchObject({ completed: false, reason: "unavailable" });
    } else {
      const result = await sandbox.execute({ command: "true" });
      expect(result.completed).toBe(true);
    }
  });
});

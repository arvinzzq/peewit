import { describe, test, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlTaskStore, BackgroundApprovalResolver, CronScheduler, matchesCron, writeHeartbeat, type TaskRunRecord } from "./index.js";
import type { ApprovalRequest } from "@vole/core";

describe("JsonlTaskStore", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  function makeRecord(id: string, overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
    return {
      id,
      taskName: "test-task",
      goal: "do something useful",
      sessionId: `session_${id}`,
      startedAt: "2026-05-05T10:00:00.000Z",
      status: "completed",
      assistantText: "Done!",
      ...overrides
    };
  }

  test("saves and lists a run record", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    const record = makeRecord("run_001");
    await store.saveRun(record);

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(record);
  });

  test("saves multiple records and lists them all", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001"));
    await store.saveRun(makeRecord("run_002"));
    await store.saveRun(makeRecord("run_003"));

    const runs = await store.listRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.id)).toEqual(["run_001", "run_002", "run_003"]);
  });

  test("listRuns respects limit — returns last N records", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001"));
    await store.saveRun(makeRecord("run_002"));
    await store.saveRun(makeRecord("run_003"));

    const runs = await store.listRuns({ limit: 2 });
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.id)).toEqual(["run_002", "run_003"]);
  });

  test("listRuns filters by taskName", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001", { taskName: "alpha" }));
    await store.saveRun(makeRecord("run_002", { taskName: "beta" }));
    await store.saveRun(makeRecord("run_003", { taskName: "alpha" }));

    const alphaRuns = await store.listRuns({ taskName: "alpha" });
    expect(alphaRuns).toHaveLength(2);
    expect(alphaRuns.map((r) => r.id)).toEqual(["run_001", "run_003"]);
  });

  test("updateRun updates a matching record by id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001", { status: "running", assistantText: "" }));

    await store.updateRun("run_001", {
      status: "completed",
      assistantText: "Task done.",
      completedAt: "2026-05-05T10:05:00.000Z"
    });

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.assistantText).toBe("Task done.");
    expect(runs[0]?.completedAt).toBe("2026-05-05T10:05:00.000Z");
  });

  test("updateRun does not affect other records", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001"));
    await store.saveRun(makeRecord("run_002", { status: "running" }));

    await store.updateRun("run_002", { status: "failed" });

    const runs = await store.listRuns();
    expect(runs[0]?.status).toBe("completed");
    expect(runs[1]?.status).toBe("failed");
  });

  test("listRuns returns empty array when file does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "nonexistent", "task-runs.jsonl"));

    const runs = await store.listRuns();
    expect(runs).toEqual([]);
  });

  test("saveRun creates parent directories if missing", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
    const store = new JsonlTaskStore(join(tmpDir, "nested", "dir", "task-runs.jsonl"));

    await store.saveRun(makeRecord("run_001"));

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
  });
});

describe("BackgroundApprovalResolver", () => {
  const fakeRequest: ApprovalRequest = {
    call: {
      id: "call_test",
      name: "shell",
      input: { command: "ls" }
    },
    decision: {
      decision: "ask",
      risk: "medium",
      reason: "Shell commands require confirmation."
    }
  };

  test("confirm mode auto-denies", async () => {
    const resolver = new BackgroundApprovalResolver("confirm");
    const resolution = await resolver.resolve(fakeRequest);
    expect(resolution.approved).toBe(false);
    expect(resolution.reason).toContain("confirm");
  });

  test("observe mode auto-denies", async () => {
    const resolver = new BackgroundApprovalResolver("observe");
    const resolution = await resolver.resolve(fakeRequest);
    expect(resolution.approved).toBe(false);
    expect(resolution.reason).toContain("observe");
  });

  test("auto mode auto-approves", async () => {
    const resolver = new BackgroundApprovalResolver("auto");
    const resolution = await resolver.resolve(fakeRequest);
    expect(resolution.approved).toBe(true);
  });

  test("default mode (no arg) auto-denies like confirm", async () => {
    const resolver = new BackgroundApprovalResolver();
    const resolution = await resolver.resolve(fakeRequest);
    expect(resolution.approved).toBe(false);
  });
});

describe("matchesCron", () => {
  test("matches all fields wildcard", () => {
    // Any date should match "* * * * *"
    expect(matchesCron("* * * * *", new Date("2026-05-05T14:30:00.000Z"))).toBe(true);
    expect(matchesCron("* * * * *", new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  test("matches specific minute and hour", () => {
    // Build a date whose local getHours()=9, getMinutes()=30
    const matching = new Date();
    matching.setHours(9, 30, 0, 0);
    expect(matchesCron("30 9 * * *", matching)).toBe(true);
  });

  test("returns false for wrong hour", () => {
    // Local hour=9, minute=30 — cron "30 10 * * *" requires hour 10
    const wrongHour = new Date();
    wrongHour.setHours(9, 30, 0, 0);
    expect(matchesCron("30 10 * * *", wrongHour)).toBe(false);
  });

  test("returns false for invalid expression (wrong parts count)", () => {
    expect(matchesCron("* * * *", new Date())).toBe(false);
    expect(matchesCron("", new Date())).toBe(false);
    expect(matchesCron("* * * * * *", new Date())).toBe(false);
  });
});

describe("CronScheduler", () => {
  test("runs a task when cron matches", async () => {
    // Use a fixed date; "* * * * *" matches any minute
    const fixedDate = new Date();
    const runnerCalls: string[] = [];
    const tasks = [{ name: "my-task", goal: "do work", cron: "* * * * *" }];
    const runner = vi.fn(async (task) => { runnerCalls.push(task.name); });

    const scheduler = new CronScheduler(tasks, runner, {
      checkIntervalMs: 60_000,
      getNow: () => fixedDate
    });

    scheduler.start();
    // Wait for the immediate tick to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.stop();

    expect(runner).toHaveBeenCalledOnce();
    expect(runnerCalls).toEqual(["my-task"]);
  });

  test("does not run a task twice in the same minute", async () => {
    const fixedDate = new Date();
    const runner = vi.fn(async () => undefined);
    const tasks = [{ name: "dedup-task", goal: "run once", cron: "* * * * *" }];

    const scheduler = new CronScheduler(tasks, runner, {
      checkIntervalMs: 1,
      getNow: () => fixedDate
    });

    scheduler.start();
    // Wait long enough for multiple ticks
    await new Promise((resolve) => setTimeout(resolve, 50));
    scheduler.stop();

    // Even with multiple ticks, only one call per minute
    expect(runner).toHaveBeenCalledOnce();
  });

  test("does not run non-matching cron tasks", async () => {
    // Use a date at local hour=10, minute=5; cron "30 9 * * *" requires hour=9, minute=30
    const fixedDate = new Date();
    fixedDate.setHours(10, 5, 0, 0);
    const runner = vi.fn(async () => undefined);
    const tasks = [{ name: "no-match-task", goal: "never runs", cron: "30 9 * * *" }];

    const scheduler = new CronScheduler(tasks, runner, {
      checkIntervalMs: 60_000,
      getNow: () => fixedDate
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.stop();

    expect(runner).not.toHaveBeenCalled();
  });

  test("start/stop lifecycle", async () => {
    const runner = vi.fn(async () => undefined);
    const tasks = [{ name: "lifecycle-task", goal: "test lifecycle", cron: "* * * * *" }];
    const scheduler = new CronScheduler(tasks, runner, {
      checkIntervalMs: 60_000,
      getNow: () => new Date()
    });

    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });
});

describe("writeHeartbeat", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("writes a markdown heartbeat file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heartbeat-test-"));
    const filePath = join(tmpDir, "HEARTBEAT.md");

    await writeHeartbeat(filePath, {
      status: "running",
      taskName: "daily-summary",
      runId: "run_abc",
      lastUpdatedAt: "2026-05-07T10:00:00.000Z"
    });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("**Status**: running");
    expect(content).toContain("**Task**: daily-summary");
    expect(content).toContain("**Run ID**: run_abc");
    expect(content).toContain("**Last updated**: 2026-05-07T10:00:00.000Z");
  });

  test("includes message when provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heartbeat-test-"));
    const filePath = join(tmpDir, "HEARTBEAT.md");

    await writeHeartbeat(filePath, {
      status: "failed",
      lastUpdatedAt: "2026-05-07T10:05:00.000Z",
      message: "Error: timeout exceeded"
    });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("**Status**: failed");
    expect(content).toContain("Error: timeout exceeded");
  });

  test("omits optional fields when not provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heartbeat-test-"));
    const filePath = join(tmpDir, "HEARTBEAT.md");

    await writeHeartbeat(filePath, {
      status: "idle",
      lastUpdatedAt: "2026-05-07T10:00:00.000Z"
    });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("**Task**");
    expect(content).not.toContain("**Run ID**");
  });

  test("overwrites existing file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heartbeat-test-"));
    const filePath = join(tmpDir, "HEARTBEAT.md");

    await writeHeartbeat(filePath, { status: "running", lastUpdatedAt: "2026-05-07T10:00:00.000Z" });
    await writeHeartbeat(filePath, { status: "completed", lastUpdatedAt: "2026-05-07T10:05:00.000Z" });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("**Status**: completed");
    expect(content).not.toContain("running");
  });

  test("creates parent directories if missing", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heartbeat-test-"));
    const filePath = join(tmpDir, "nested", "dir", "HEARTBEAT.md");

    await writeHeartbeat(filePath, { status: "idle", lastUpdatedAt: "2026-05-07T10:00:00.000Z" });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("**Status**: idle");
  });
});

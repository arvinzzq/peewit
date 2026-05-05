import { describe, test, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlTaskStore, BackgroundApprovalResolver, type TaskRunRecord } from "./index.js";
import type { ApprovalRequest } from "@arvinclaw/core";

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

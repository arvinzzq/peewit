import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlTaskFlowStore } from "./index.js";

function makeTempPath(dir: string, filename: string): string {
  return join(dir, filename);
}

describe("JsonlTaskFlowStore", () => {
  test("creates a task record with timestamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      const record = await store.create({
        id: "task_1",
        runtime: "subagent",
        task: "Do something useful",
        status: "queued"
      });

      expect(record.id).toBe("task_1");
      expect(record.runtime).toBe("subagent");
      expect(record.task).toBe("Do something useful");
      expect(record.status).toBe("queued");
      expect(typeof record.createdAt).toBe("string");
      expect(typeof record.updatedAt).toBe("string");
      expect(record.createdAt).toBe(record.updatedAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("updates task status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      await store.create({
        id: "task_2",
        runtime: "background",
        task: "Run something",
        status: "queued"
      });

      const updated = await store.update("task_2", { status: "running" });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe("running");
      expect(updated?.id).toBe("task_2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when updating nonexistent id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      const result = await store.update("nonexistent_id", { status: "failed" });

      expect(result).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("gets a task by id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      await store.create({
        id: "task_get",
        runtime: "cli",
        task: "Find this task",
        status: "queued"
      });

      const found = await store.get("task_get");

      expect(found).toBeDefined();
      expect(found?.id).toBe("task_get");
      expect(found?.task).toBe("Find this task");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined for get with unknown id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      const found = await store.get("no_such_id");

      expect(found).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lists all records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      await store.create({ id: "t1", runtime: "cli", task: "First task", status: "queued" });
      await store.create({ id: "t2", runtime: "cron", task: "Second task", status: "running" });
      await store.create({ id: "t3", runtime: "background", task: "Third task", status: "succeeded" });

      const all = await store.list();

      expect(all).toHaveLength(3);
      expect(all.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("filters by status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      await store.create({ id: "s1", runtime: "cli", task: "Queued task", status: "queued" });
      await store.create({ id: "s2", runtime: "cli", task: "Running task", status: "running" });
      await store.create({ id: "s3", runtime: "cli", task: "Another queued", status: "queued" });

      const queued = await store.list({ status: "queued" });

      expect(queued).toHaveLength(2);
      expect(queued.map((r) => r.id)).toEqual(["s1", "s3"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("filters by parentId (sub-tasks)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      await store.create({ id: "parent_1", runtime: "cli", task: "Parent task", status: "running" });
      await store.create({ id: "child_1", runtime: "subagent", task: "Child one", status: "queued", parentId: "parent_1" });
      await store.create({ id: "child_2", runtime: "subagent", task: "Child two", status: "running", parentId: "parent_1" });
      await store.create({ id: "other_1", runtime: "cli", task: "Unrelated task", status: "queued" });

      const children = await store.list({ parentId: "parent_1" });

      expect(children).toHaveLength(2);
      expect(children.map((r) => r.id)).toEqual(["child_1", "child_2"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("respects limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-taskflow-"));
    try {
      const store = new JsonlTaskFlowStore(makeTempPath(dir, "tasks.jsonl"));
      for (let i = 1; i <= 5; i++) {
        await store.create({ id: `lim_${i}`, runtime: "cli", task: `Task ${i}`, status: "queued" });
      }

      const limited = await store.list({ limit: 2 });

      expect(limited).toHaveLength(2);
      // slice(-2) returns last two
      expect(limited.map((r) => r.id)).toEqual(["lim_4", "lim_5"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

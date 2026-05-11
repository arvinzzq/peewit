import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppendDailyMemoryResult, MemoryGetResult, MemorySearchResult } from "@vole/tools";
import {
  createAppendDailyMemoryTool,
  createMemoryGetTool,
  createMemorySearchTool
} from "./index.js";

describe("append_daily_memory tool", () => {
  test("appends a note to today's daily memory file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      const result = await tool.execute({ content: "Learned about update_todos." }, { workspaceRoot: workspace });
      expect(result).toMatchObject({ ok: true, filePath: "memory/2026-05-04.md" });

      const written = await readFile(join(workspace, "memory", "2026-05-04.md"), "utf8");
      expect(written).toContain("Learned about update_todos.");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("appends multiple notes to the same file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      await tool.execute({ content: "First note." }, { workspaceRoot: workspace });
      await tool.execute({ content: "Second note." }, { workspaceRoot: workspace });

      const written = await readFile(join(workspace, "memory", "2026-05-04.md"), "utf8");
      expect(written).toContain("First note.");
      expect(written).toContain("Second note.");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("creates the memory directory if it does not exist", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      const result = await tool.execute({ content: "Note." }, { workspaceRoot: workspace }) as AppendDailyMemoryResult;
      expect(result).toMatchObject({ ok: true });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("returns error for empty content", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-memory-"));
    try {
      const tool = createAppendDailyMemoryTool();
      const result = await tool.execute({ content: "   " }, { workspaceRoot: workspace });
      expect(result).toMatchObject({ ok: false });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("createMemorySearchTool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns empty results when memory directory does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      const tool = createMemorySearchTool(join(dir, "nonexistent"));
      const result = await tool.execute({ query: "anything" }, ctx) as MemorySearchResult;
      expect(result).toEqual({ ok: true, results: [], total: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("finds matching content in MEMORY.md file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "This is an important fact.\n\nThis paragraph is unrelated.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "important" }, ctx) as MemorySearchResult;
      expect(result.ok).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.excerpt).toContain("important fact");
      expect(result.results[0]?.file).toBe("MEMORY.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("respects maxResults limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} about memory stuff`);
      await writeFile(join(dir, "MEMORY.md"), paragraphs.join("\n\n"));
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "memory", maxResults: 3 }, ctx) as MemorySearchResult;
      expect(result.results.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("is case-insensitive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "This mentions ImportantFact uppercase.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "importantfact" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("searches USER.md in addition to MEMORY.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      await writeFile(join(dir, "USER.md"), "User prefers short answers.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "prefers" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.file).toBe("USER.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("searches daily memory files in memory/ subdirectory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-"));
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "memory", "2026-05-05.md"), "Daily note about architecture.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "architecture" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.file).toContain("2026-05-05.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createMemoryGetTool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns file content for a valid path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memget-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "# Memory\n\nKey fact here.");
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "MEMORY.md" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Key fact here.");
      expect(result.error).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns error for missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "MEMORY.md" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toContain("File not found");
      expect(result.content).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path traversal attempts (..)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "../etc/passwd" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects absolute paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "/etc/passwd" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects non-.md files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "file.txt" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppendDailyMemoryResult, MemoryGetResult, MemorySearchResult } from "@vole/tools";
import {
  FakeEmbeddingProvider,
  applyDreamDecision,
  createAppendDailyMemoryTool,
  createMemoryGetTool,
  createMemorySearchTool,
  parseDreamsFile,
  readDreamsFile,
  serializeDreamsFile,
  type DreamEntry,
  type EmbeddingProvider
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

describe("FakeEmbeddingProvider", () => {
  test("produces deterministic L2-normalized vectors", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 32 });
    const [a, b] = await provider.embed(["hello world", "hello world"]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    let dot = 0;
    for (let i = 0; i < 32; i++) dot += (a![i] ?? 0) * (b![i] ?? 0);
    expect(dot).toBeCloseTo(1, 5);
  });

  test("orthogonal-ish vectors for token-disjoint texts", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 64 });
    const [a, b] = await provider.embed(["cat dog parrot", "calculus integral derivative"]);
    let dot = 0;
    for (let i = 0; i < 64; i++) dot += (a![i] ?? 0) * (b![i] ?? 0);
    expect(Math.abs(dot)).toBeLessThan(0.95);
  });
});

describe("createMemorySearchTool (hybrid)", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("uses vector ranking when an EmbeddingProvider is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-hybrid-"));
    try {
      await writeFile(
        join(dir, "MEMORY.md"),
        "The user prefers concise answers.\n\nPython is the preferred language for data work.\n\nWeather today is sunny."
      );
      const provider = new FakeEmbeddingProvider({ dimensions: 64 });
      const tool = createMemorySearchTool(dir, { embeddingProvider: provider });
      // Query shares no surface keyword with "Python" paragraph but does share with "concise answers".
      const result = await tool.execute({ query: "user concise" }, ctx) as MemorySearchResult;
      expect(result.ok).toBe(true);
      expect(result.results[0]?.excerpt).toContain("concise");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to keyword-only on embedding provider failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-fallback-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "Important architectural decision logged here.");
      const failingProvider: EmbeddingProvider = {
        name: "openai",
        dimensions: 8,
        async embed(): Promise<Float32Array[]> {
          throw new Error("simulated provider outage");
        }
      };
      const tool = createMemorySearchTool(dir, { embeddingProvider: failingProvider });
      const result = await tool.execute({ query: "architectural" }, ctx) as MemorySearchResult;
      expect(result.ok).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.excerpt).toContain("architectural");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fuses keyword and vector signals via RRF when both rank a paragraph highly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vole-memsearch-rrf-"));
    try {
      await writeFile(
        join(dir, "MEMORY.md"),
        Array.from({ length: 8 }, (_, i) => `Paragraph ${i} about distinct topic ${"abcdefgh"[i] ?? "z"}`).join("\n\n") +
          "\n\nThis paragraph mentions database migrations explicitly."
      );
      const tool = createMemorySearchTool(dir, { embeddingProvider: new FakeEmbeddingProvider() });
      const result = await tool.execute({ query: "database migrations" }, ctx) as MemorySearchResult;
      expect(result.ok).toBe(true);
      expect(result.results[0]?.excerpt).toContain("database migrations");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("DREAMS.md review workflow", () => {
  const sample = [
    "# Dream Entries — Pending Review",
    "",
    "## [pending] 2026-05-12-001",
    "**Source**: memory/2026-05-10.md, memory/2026-05-11.md",
    "",
    "The user strongly prefers concise responses without trailing summaries.",
    "",
    "---",
    "",
    "## [pending] 2026-05-12-002",
    "",
    "Vole now ships SqliteSessionStore as an option.",
    "",
    "---",
    ""
  ].join("\n");

  test("parseDreamsFile reads pending entries with id, source, and body", () => {
    const entries = parseDreamsFile(sample);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "2026-05-12-001",
      status: "pending",
      source: "memory/2026-05-10.md, memory/2026-05-11.md"
    });
    expect(entries[0]?.body).toContain("concise responses");
    expect(entries[1]?.id).toBe("2026-05-12-002");
    expect(entries[1]?.source).toBeUndefined();
    expect(entries[1]?.body).toContain("SqliteSessionStore");
  });

  test("serializeDreamsFile round-trips entries through parse", () => {
    const original: DreamEntry[] = [
      { id: "a", status: "pending", body: "First body." },
      { id: "b", status: "pending", source: "MEMORY.md", body: "Second body." }
    ];
    const reparsed = parseDreamsFile(serializeDreamsFile(original));
    expect(reparsed).toEqual(original);
  });

  test("readDreamsFile returns empty list when DREAMS.md is missing", async () => {
    const ws = await mkdtemp(join(tmpdir(), "vole-dreams-missing-"));
    try {
      expect(await readDreamsFile(ws)).toEqual([]);
    } finally {
      await rm(ws, { force: true, recursive: true });
    }
  });

  test("applyDreamDecision approve appends entry to MEMORY.md and removes from DREAMS.md", async () => {
    const ws = await mkdtemp(join(tmpdir(), "vole-dreams-approve-"));
    try {
      await writeFile(join(ws, "DREAMS.md"), sample);
      const result = await applyDreamDecision(ws, "2026-05-12-001", "approve", {
        now: () => new Date("2026-05-12T10:00:00Z")
      });
      expect(result?.status).toBe("approved");

      const memory = await readFile(join(ws, "MEMORY.md"), "utf8");
      expect(memory).toContain("Promoted from DREAMS.md (2026-05-12-001");
      expect(memory).toContain("concise responses");

      const remaining = parseDreamsFile(await readFile(join(ws, "DREAMS.md"), "utf8"));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("2026-05-12-002");
    } finally {
      await rm(ws, { force: true, recursive: true });
    }
  });

  test("applyDreamDecision reject moves entry to DREAMS/archive/<id>.md", async () => {
    const ws = await mkdtemp(join(tmpdir(), "vole-dreams-reject-"));
    try {
      await writeFile(join(ws, "DREAMS.md"), sample);
      const result = await applyDreamDecision(ws, "2026-05-12-002", "reject", {
        now: () => new Date("2026-05-12T10:00:00Z")
      });
      expect(result?.status).toBe("rejected");

      const archived = await readFile(join(ws, "DREAMS", "archive", "2026-05-12-002.md"), "utf8");
      expect(archived).toContain("Status: rejected");
      expect(archived).toContain("SqliteSessionStore");

      const remaining = parseDreamsFile(await readFile(join(ws, "DREAMS.md"), "utf8"));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("2026-05-12-001");
    } finally {
      await rm(ws, { force: true, recursive: true });
    }
  });

  test("applyDreamDecision returns undefined when id is not present", async () => {
    const ws = await mkdtemp(join(tmpdir(), "vole-dreams-missing-id-"));
    try {
      await writeFile(join(ws, "DREAMS.md"), sample);
      const result = await applyDreamDecision(ws, "no-such-id", "approve");
      expect(result).toBeUndefined();
    } finally {
      await rm(ws, { force: true, recursive: true });
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

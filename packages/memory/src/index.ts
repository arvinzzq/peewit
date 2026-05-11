/**
 * INPUT: Workspace root, memory file paths (MEMORY.md, USER.md, memory/YYYY-MM-DD.md), search queries, append content, current date.
 * OUTPUT: Memory tools (memory_search, memory_get, append_daily_memory) returning MemorySearchResult / MemoryGetResult / AppendDailyMemoryResult; reserved EmbeddingProvider interface for Phase 13 Step 3 hybrid retrieval.
 * POS: Memory layer; owns workspace-file reads/writes for the agent's durable mailbox. Replaces the equivalent factories that previously lived in @vole/tools.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { mkdir, readdir, readFile, writeFile as writeFileFs, access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  AppendDailyMemoryResult,
  ExecutableTool,
  MemoryGetResult,
  MemorySearchResult,
  ToolExecutionFailure
} from "@vole/tools";

export const memoryPackageName = "@vole/memory";

// Phase 13 Step 3 placeholder: full implementation lands in the next commit.
// The interface is exported now so downstream callers can begin to depend on it.
export interface EmbeddingProvider {
  readonly name: "openai" | "voyage";
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function createMemorySearchTool(workspaceRoot: string): ExecutableTool {
  return {
    name: "memory_search",
    description: "Search over memory files (MEMORY.md, USER.md, memory/YYYY-MM-DD.md) for relevant content. Returns matching excerpts.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" }
      },
      required: ["query"]
    },
    async execute(input): Promise<MemorySearchResult> {
      const raw = input as { query?: unknown; maxResults?: unknown };
      const query = typeof raw.query === "string" ? raw.query : "";
      const maxResults = typeof raw.maxResults === "number" ? raw.maxResults : 5;

      const candidateFiles: string[] = [];

      const rootMemoryMd = join(workspaceRoot, "MEMORY.md");
      const rootUserMd = join(workspaceRoot, "USER.md");
      const memorySubdir = join(workspaceRoot, "memory");

      for (const candidatePath of [rootMemoryMd, rootUserMd]) {
        try {
          await access(candidatePath);
          candidateFiles.push(candidatePath);
        } catch {
          // file does not exist — skip
        }
      }

      try {
        const entries = await readdir(memorySubdir, { recursive: true, withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const dir = typeof entry.parentPath === "string" ? entry.parentPath : (entry as unknown as { path: string }).path;
            candidateFiles.push(join(dir, entry.name));
          }
        }
      } catch {
        // memory subdir does not exist — skip
      }

      if (candidateFiles.length === 0) {
        return { ok: true, results: [], total: 0 };
      }

      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
      const matches: Array<{ file: string; excerpt: string }> = [];

      // Scan all files before truncating to maxResults so that a single large file
      // cannot crowd out matches in USER.md, daily notes, or other memory files.
      for (const filePath of candidateFiles) {
        let content: string;
        try {
          content = await readFile(filePath, "utf8");
        } catch {
          continue;
        }

        const paragraphs = content.split(/\n\n+/);
        const relPath = relative(workspaceRoot, filePath);

        for (const paragraph of paragraphs) {
          const lowerParagraph = paragraph.toLowerCase();
          if (queryWords.some((word) => lowerParagraph.includes(word))) {
            matches.push({ file: relPath, excerpt: paragraph.trim() });
          }
        }
      }

      const truncated = matches.slice(0, maxResults);
      return { ok: true, results: truncated, total: truncated.length };
    }
  };
}

export function createMemoryGetTool(workspaceRoot: string): ExecutableTool {
  return {
    name: "memory_get",
    description: "Read the full contents of a specific memory file. Valid paths: MEMORY.md, USER.md, memory/YYYY-MM-DD.md",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within the memory workspace, e.g. MEMORY.md or memory/2026-05-05.md" }
      },
      required: ["path"]
    },
    async execute(input): Promise<MemoryGetResult> {
      const raw = input as { path?: unknown };
      const requestedPath = typeof raw.path === "string" ? raw.path : "";

      if (requestedPath.includes("..")) {
        return { ok: true, error: "Path traversal is not permitted." };
      }
      if (requestedPath.startsWith("/")) {
        return { ok: true, error: "Absolute paths are not permitted." };
      }
      if (!requestedPath.endsWith(".md")) {
        return { ok: true, error: "Only .md files are permitted." };
      }

      const resolvedRoot = resolve(workspaceRoot);
      const resolvedPath = resolve(resolvedRoot, requestedPath);

      if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
        return { ok: true, error: "Path traversal is not permitted." };
      }

      try {
        const content = await readFile(resolvedPath, "utf8");
        return { ok: true, content };
      } catch {
        return { ok: true, error: `File not found: ${requestedPath}` };
      }
    }
  };
}

export function createAppendDailyMemoryTool(
  options?: { getCurrentDate?: () => string }
): ExecutableTool {
  return {
    name: "append_daily_memory",
    description: "Append a note to today's daily memory file (memory/YYYY-MM-DD.md) in the workspace. Use this to record facts, decisions, or observations worth remembering across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" }
      },
      required: ["content"]
    },
    risk: "medium",
    async execute(input, context): Promise<AppendDailyMemoryResult | ToolExecutionFailure> {
      const raw = input as { content?: unknown };
      if (typeof raw.content !== "string" || raw.content.trim().length === 0) {
        return { ok: false, error: { code: "invalid_input", message: "content must be a non-empty string." } };
      }

      const today = options?.getCurrentDate?.() ?? new Date().toISOString().slice(0, 10);
      const memoryDir = resolve(context.workspaceRoot, "memory");
      const filePath = resolve(memoryDir, `${today}.md`);

      try {
        await mkdir(memoryDir, { recursive: true });
        const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        const entry = `\n## ${timestamp}\n\n${raw.content.trim()}\n`;
        await writeFileFs(filePath, entry, { flag: "a" });

        return {
          ok: true,
          filePath: `memory/${today}.md`,
          summary: `Appended note to memory/${today}.md.`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to write daily memory.";
        return { ok: false, error: { code: "write_error", message } };
      }
    }
  };
}

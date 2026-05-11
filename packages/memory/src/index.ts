/**
 * INPUT: Workspace root, memory file paths (MEMORY.md, USER.md, memory/YYYY-MM-DD.md), search queries, append content, current date, optional EmbeddingProvider for vector-augmented retrieval.
 * OUTPUT: Memory tools (memory_search, memory_get, append_daily_memory) returning MemorySearchResult / MemoryGetResult / AppendDailyMemoryResult; EmbeddingProvider interface plus FakeEmbeddingProvider; hybrid retrieval with reciprocal rank fusion when an EmbeddingProvider is supplied, keyword-only otherwise.
 * POS: Memory layer; owns workspace-file reads/writes for the agent's durable mailbox plus retrieval ranking. Replaces the equivalent factories that previously lived in @vole/tools.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { createHash } from "node:crypto";
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

export type EmbeddingProviderName = "openai" | "voyage" | "fake";

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * FakeEmbeddingProvider: deterministic token-bag embeddings useful for unit tests
 * and for graceful degradation when no real provider credentials are configured.
 * Vectors are SHA-256 derived per-token and summed, then L2-normalized so cosine
 * similarity reflects token overlap. Paragraphs sharing tokens land near each
 * other in vector space; paragraphs with no shared tokens are orthogonal.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake" as const;
  readonly dimensions: number;

  constructor(options?: { dimensions?: number }) {
    this.dimensions = options?.dimensions ?? 64;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/u).filter((t) => t.length > 0);
    for (const token of tokens) {
      const hash = createHash("sha256").update(token).digest();
      for (let i = 0; i < this.dimensions; i++) {
        const byte = hash[i % hash.length] ?? 0;
        v[i] = (v[i] ?? 0) + (byte - 127) / 127;
      }
    }
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) v[i] = (v[i] ?? 0) / norm;
    }
    return v;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

interface ParagraphRecord {
  file: string;
  excerpt: string;
}

/**
 * Reciprocal Rank Fusion: combines two ranked lists into one. For each item,
 * score = sum over lists of 1 / (k + rank). The classic choice k = 60.
 */
function reciprocalRankFusion(
  ranked: Array<Array<{ key: string; record: ParagraphRecord }>>,
  k: number
): ParagraphRecord[] {
  const scores = new Map<string, { score: number; record: ParagraphRecord }>();
  for (const list of ranked) {
    list.forEach((item, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (k + rank);
      const existing = scores.get(item.key);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(item.key, { score: contribution, record: item.record });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.record);
}

export interface MemorySearchToolOptions {
  /**
   * Optional EmbeddingProvider. When supplied, memory_search runs hybrid
   * retrieval: vector top-K plus keyword paragraph match, fused with
   * reciprocal rank fusion. When omitted, falls back to keyword-only.
   */
  embeddingProvider?: EmbeddingProvider;
  /** Vector top-K before fusion. Default 10. */
  topKVector?: number;
  /** RRF constant k. Default 60. */
  fusionConstant?: number;
}

export function createMemorySearchTool(
  workspaceRoot: string,
  options?: MemorySearchToolOptions
): ExecutableTool {
  const embeddingProvider = options?.embeddingProvider;
  const topKVector = options?.topKVector ?? 10;
  const fusionConstant = options?.fusionConstant ?? 60;

  return {
    name: "memory_search",
    description: embeddingProvider === undefined
      ? "Search over memory files (MEMORY.md, USER.md, memory/YYYY-MM-DD.md) for relevant content. Returns matching excerpts."
      : "Hybrid search over memory files (MEMORY.md, USER.md, memory/YYYY-MM-DD.md): combines keyword paragraph match with vector top-K from the configured embedding provider, fused via reciprocal rank fusion.",
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

      const allParagraphs: Array<{ key: string; record: ParagraphRecord }> = [];
      for (const filePath of candidateFiles) {
        let content: string;
        try {
          content = await readFile(filePath, "utf8");
        } catch {
          continue;
        }
        const paragraphs = content.split(/\n\n+/);
        const relPath = relative(workspaceRoot, filePath);
        paragraphs.forEach((paragraph, idx) => {
          const trimmed = paragraph.trim();
          if (trimmed.length === 0) return;
          allParagraphs.push({
            key: `${relPath}#${idx}`,
            record: { file: relPath, excerpt: trimmed }
          });
        });
      }

      if (allParagraphs.length === 0) {
        return { ok: true, results: [], total: 0 };
      }

      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
      const keywordRanked = allParagraphs.filter((entry) => {
        const lower = entry.record.excerpt.toLowerCase();
        return queryWords.some((word) => lower.includes(word));
      });

      if (embeddingProvider === undefined) {
        const truncated = keywordRanked.slice(0, maxResults).map((item) => item.record);
        return { ok: true, results: truncated, total: truncated.length };
      }

      // Hybrid path: embed query + all paragraphs, rank by cosine, fuse with keyword rank.
      let vectorRanked: Array<{ key: string; record: ParagraphRecord }> = [];
      try {
        const embeddings = await embeddingProvider.embed([query, ...allParagraphs.map((p) => p.record.excerpt)]);
        const queryVec = embeddings[0];
        if (queryVec !== undefined && embeddings.length === allParagraphs.length + 1) {
          const scored = allParagraphs.map((entry, idx) => {
            const vec = embeddings[idx + 1];
            const score = vec === undefined ? 0 : cosineSimilarity(queryVec, vec);
            return { entry, score };
          });
          scored.sort((a, b) => b.score - a.score);
          vectorRanked = scored.slice(0, topKVector).map((s) => s.entry);
        }
      } catch {
        // embedding failure → silently fall back to keyword-only
        vectorRanked = [];
      }

      const fused = reciprocalRankFusion([vectorRanked, keywordRanked], fusionConstant);
      const truncated = fused.slice(0, maxResults);
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

// ─── Phase 13b Step 4: DREAMS.md review workflow ──────────────────────────────

export type DreamEntryStatus = "pending" | "approved" | "rejected";

export interface DreamEntry {
  id: string;
  status: DreamEntryStatus;
  source?: string;
  body: string;
}

const DREAM_ENTRY_HEADER_RE = /^## \[(pending|approved|rejected)\]\s+([A-Za-z0-9_.\-]+)\s*$/;
const DREAM_SOURCE_LINE_RE = /^\*\*Source\*\*:\s*(.*)$/;

/**
 * Parse a DREAMS.md document into its individual entries. Entries are separated
 * by `---` lines; each entry starts with `## [status] <id>` and may have a
 * `**Source**: ...` second line. The remaining lines until the next `---` or
 * end-of-file form the body.
 *
 * Free-form text outside entry blocks is silently skipped — the agent is
 * allowed to add notes between entries and they will not become DreamEntry
 * records.
 */
export function parseDreamsFile(content: string): DreamEntry[] {
  const entries: DreamEntry[] = [];
  const lines = content.split(/\r?\n/);
  let current: { id: string; status: DreamEntryStatus; source?: string; bodyLines: string[] } | undefined;

  const flush = () => {
    if (current === undefined) return;
    while (current.bodyLines.length > 0 && current.bodyLines[current.bodyLines.length - 1]?.trim() === "") {
      current.bodyLines.pop();
    }
    while (current.bodyLines.length > 0 && current.bodyLines[0]?.trim() === "") {
      current.bodyLines.shift();
    }
    entries.push({
      id: current.id,
      status: current.status,
      ...(current.source !== undefined ? { source: current.source } : {}),
      body: current.bodyLines.join("\n").trim()
    });
    current = undefined;
  };

  for (const line of lines) {
    const headerMatch = line.match(DREAM_ENTRY_HEADER_RE);
    if (headerMatch !== null) {
      flush();
      const [, statusRaw, id] = headerMatch;
      current = {
        id: id ?? "",
        status: (statusRaw ?? "pending") as DreamEntryStatus,
        bodyLines: []
      };
      continue;
    }
    if (line.trim() === "---") {
      flush();
      continue;
    }
    if (current === undefined) continue;
    if (current.source === undefined && current.bodyLines.length === 0) {
      const sourceMatch = line.match(DREAM_SOURCE_LINE_RE);
      if (sourceMatch !== null) {
        current.source = (sourceMatch[1] ?? "").trim();
        continue;
      }
    }
    current.bodyLines.push(line);
  }
  flush();
  return entries;
}

export function serializeDreamsFile(entries: DreamEntry[]): string {
  const blocks: string[] = ["# Dream Entries — Pending Review", ""];
  for (const entry of entries) {
    blocks.push(`## [${entry.status}] ${entry.id}`);
    if (entry.source !== undefined) blocks.push(`**Source**: ${entry.source}`);
    blocks.push("");
    blocks.push(entry.body.trim());
    blocks.push("");
    blocks.push("---");
    blocks.push("");
  }
  return blocks.join("\n");
}

/**
 * Read DREAMS.md from the workspace and return its parsed entries. Returns
 * an empty array if the file does not exist.
 */
export async function readDreamsFile(workspaceRoot: string): Promise<DreamEntry[]> {
  const dreamsPath = resolve(workspaceRoot, "DREAMS.md");
  try {
    const content = await readFile(dreamsPath, "utf8");
    return parseDreamsFile(content);
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}

/**
 * Apply a single approve/reject decision to DREAMS.md.
 *
 * - "approve": removes the entry from DREAMS.md and appends it to MEMORY.md as
 *   a timestamped section.
 * - "reject": removes the entry from DREAMS.md and archives it under
 *   `DREAMS/archive/<id>.md`.
 *
 * Returns the post-decision DreamEntry (with updated status) or undefined when
 * no entry with the given id was found.
 */
export async function applyDreamDecision(
  workspaceRoot: string,
  id: string,
  decision: "approve" | "reject",
  options?: { now?: () => Date }
): Promise<DreamEntry | undefined> {
  const root = resolve(workspaceRoot);
  const dreamsPath = resolve(root, "DREAMS.md");
  const memoryPath = resolve(root, "MEMORY.md");

  let entries: DreamEntry[];
  try {
    entries = parseDreamsFile(await readFile(dreamsPath, "utf8"));
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }

  const idx = entries.findIndex((entry) => entry.id === id);
  if (idx === -1) return undefined;
  const target = entries[idx]!;
  const remaining = [...entries.slice(0, idx), ...entries.slice(idx + 1)];

  if (decision === "approve") {
    const now = (options?.now?.() ?? new Date()).toISOString();
    const block = `\n## Promoted from DREAMS.md (${id}, ${now})\n\n${target.body}\n`;
    await writeFileFs(memoryPath, block, { flag: "a" });
  } else {
    const archiveDir = resolve(root, "DREAMS", "archive");
    await mkdir(archiveDir, { recursive: true });
    const body = `# ${id}\n\nStatus: rejected\nArchived-At: ${(options?.now?.() ?? new Date()).toISOString()}\n\n${target.body}\n`;
    await writeFileFs(resolve(archiveDir, `${id}.md`), body);
  }

  await writeFileFs(dreamsPath, serializeDreamsFile(remaining));
  return { ...target, status: decision === "approve" ? "approved" : "rejected" };
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

# Memory Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/memory` owns the **workspace memory layer**: reads of `MEMORY.md`, `USER.md`, and `memory/YYYY-MM-DD.md`; writes to today's daily memory file. It exports the three model-callable tools the agent uses to interact with its mailbox:

```
agent runtime
    │  tool calls
    ▼
@vole/memory
    ├─ memory_search         (hybrid in Phase 13 Step 3, keyword today)
    ├─ memory_get
    └─ append_daily_memory
```

Phase 13 Step 2 split this package off from `@vole/tools` so memory concerns can grow independently. Step 3 will add an `EmbeddingProvider` interface and hybrid retrieval. Step 4 will add DREAMS.md review flow.

## Core Concepts

### memory_search

```ts
{ query: string; maxResults?: number }
  → { ok: true; results: Array<{ file: string; excerpt: string }>; total: number }
```

Paragraph-level keyword matching across `MEMORY.md`, `USER.md`, and every file under `memory/` is the always-on path. When `createMemorySearchTool(workspaceRoot, { embeddingProvider })` is supplied, the tool additionally embeds every paragraph plus the query, ranks paragraphs by cosine similarity (top-K, default 10), and **fuses the vector ranking with the keyword ranking via reciprocal rank fusion** (default constant k=60). The tool signature is identical to the keyword-only path. If the provider throws, the tool silently falls back to keyword-only — an embedding outage cannot block the agent.

### memory_get

```ts
{ path: string }  // path must end in .md and stay inside the workspace
  → { ok: true; content?: string; error?: string }
```

Safe-read by path. Rejects `..` traversal, absolute paths, and non-`.md` files. Returns either `content` or `error` on the same shape — the model can branch without try/catch.

### append_daily_memory

```ts
{ content: string }
  → { ok: true; filePath: "memory/YYYY-MM-DD.md"; summary: string }
```

Appends a timestamped `## HH:MM` block to today's daily file. Creates the `memory/` directory on first use. Empty content is rejected with `ok: false`.

### EmbeddingProvider

```ts
interface EmbeddingProvider {
  readonly name: "openai" | "voyage" | "fake";
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

`FakeEmbeddingProvider` ships with the package — deterministic SHA-256-derived token-bag vectors, L2-normalized. It is the safe default for unit tests and is what the agent uses when no real provider is configured. Real `openai` / `voyage` adapters consume the same interface and slot in without changing call sites.

## Implementation Principles

### Why a Separate Package

Memory has its own roadmap: hybrid retrieval, dreaming, review workflow, eventual SQLite + FTS5 storage. Keeping it next to filesystem and shell tools in `@vole/tools` would inflate that package's surface area and slow refactors. The split is cheap: result types stay in `@vole/tools` as part of the `ToolExecutionResult` union, and `@vole/memory` imports them.

### Read-Only by Default

`memory_search` and `memory_get` are low-risk read paths. `append_daily_memory` is the only write surface and it lives in a date-stamped file, so the agent cannot accidentally clobber `MEMORY.md` or `USER.md` — those remain user-owned and curator-edited.

### Path Safety

`memory_get` validates input before touching the filesystem: rejects `..` traversal, rejects absolute paths, requires `.md` extension. The final resolved path must remain inside the workspace root.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the memory package with one workspace dependency on `@vole/tools` (for result types). |
| `tsconfig.json` | TypeScript config | Builds the memory package; references `@vole/tools`. |
| `src/index.ts` | Memory tools + hybrid retrieval + DREAMS workflow | Exports `memoryPackageName`, `EmbeddingProvider`, `EmbeddingProviderName`, `FakeEmbeddingProvider`, `MemorySearchToolOptions`, `createMemorySearchTool`, `createMemoryGetTool`, `createAppendDailyMemoryTool`, plus the Phase 13b Step 4 DREAMS.md primitives: `DreamEntry`, `DreamEntryStatus`, `parseDreamsFile`, `serializeDreamsFile`, `readDreamsFile`, `applyDreamDecision`. |
| `src/index.test.ts` | Memory tests | Covers append, keyword search, hybrid search (FakeEmbedding determinism + orthogonality, vector ranking, keyword-only fallback, RRF fusion), get (valid + missing + traversal + absolute + non-md), and DREAMS workflow (parse, serialize round-trip, missing-file empty list, approve appends to MEMORY.md, reject archives under DREAMS/archive/, unknown-id returns undefined). |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

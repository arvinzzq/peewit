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

Today the tool does paragraph-level keyword matching across `MEMORY.md`, `USER.md`, and every file under `memory/`. Phase 13 Step 3 will add embedding-based vector retrieval that fuses with the keyword path via reciprocal rank fusion; the tool signature stays the same.

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

### EmbeddingProvider (reserved)

```ts
interface EmbeddingProvider {
  readonly name: "openai" | "voyage";
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

Exported now as a forward-looking type. Phase 13 Step 3 adds the two adapters and wires hybrid search.

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
| `src/index.ts` | Memory tools | Exports `memoryPackageName`, `EmbeddingProvider`, `createMemorySearchTool`, `createMemoryGetTool`, `createAppendDailyMemoryTool`. |
| `src/index.test.ts` | Memory tests | Migrated from `@vole/tools`. Covers append (success + empty content + multi-append + directory creation), search (empty dir, MEMORY.md + USER.md + daily notes hits, case-insensitive, maxResults), get (valid + missing + traversal + absolute + non-md rejection). |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

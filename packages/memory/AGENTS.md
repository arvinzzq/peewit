# Memory Agent Guide

## Responsibility

Workspace memory layer: read MEMORY.md / USER.md / memory/YYYY-MM-DD.md, write today's daily note. Exports the model-callable tools `memory_search`, `memory_get`, and `append_daily_memory`. Phase 13 Step 3 will add the `EmbeddingProvider` interface and hybrid search.

## When Files Change

Update README and AGENTS files when memory tool surface or file inventory changes. Update `src/index.ts` header when inputs, outputs, or system position change. Heading parity between EN and zh-CN must hold.

## Testing

Memory tests must cover: append (success + empty content rejection + multi-append + directory auto-create), search (no memory dir, MEMORY.md hit, USER.md hit, daily notes hit, case-insensitivity, maxResults bound), get (valid + missing + traversal + absolute path + non-md rejection). Use real temporary directories (`mkdtemp`); never mock `node:fs/promises`.

## Boundaries

Do not import `@vole/core`, `@vole/sessions`, or any runtime layer. Memory is a tool-set leaf next to `@vole/tools`. Tool result type interfaces (`MemorySearchResult`, `MemoryGetResult`, `AppendDailyMemoryResult`, `ToolExecutionFailure`) remain in `@vole/tools` so the `ToolExecutionResult` discriminated union stays single-sourced; this package imports them.

Do not perform tasks that belong elsewhere: prompt assembly stays in `@vole/context`, compaction stays in `@vole/context`, dreaming orchestration stays in `@vole/scheduler` / `apps/cli`. This package is the read/write layer only.

# Phase 14: SQLite Storage Unification

Status: Partial (Steps 1–4 + Step 6 shipped; Steps 5, 7 deferred to Phase 14b)
Date: 2026-05-12

Simplified Chinese version: [phase-14-sqlite-storage-unification.zh-CN.md](./phase-14-sqlite-storage-unification.zh-CN.md)

## Progress

Status: Partial — the two highest-traffic stores are SQLite-capable, hybrid `memory_search` is wired in 13b on the in-memory path, and the JSONL-to-SQLite migration command is available. The FTS5 / vector index and the startup migration prompt are still queued.

Completed commits:

- [x] Step 1: docs(arch) Phase 14 callouts on session-storage and task-flow — `2d0d0f2`
- [x] Step 2 + 3: feat(sessions) better-sqlite3 + SqliteSessionStore with WAL — `0c72269`
- [x] Step 4: feat(taskflow) SqliteTaskFlowStore with single-transaction drainPendingForParent — `c83edd8`
- [x] Step 6 (14b): feat(sessions,taskflow,cli) `vole migrate jsonl-to-sqlite` (dry-run + --apply); schema DDL extracted to `SQLITE_SESSIONS_SCHEMA_SQL` / `SQLITE_TASKFLOW_SCHEMA_SQL` so the migration helper can initialize a fresh database without auto-generating IDs — `df041e6`
- [x] Step 8: docs mark Phase 14 partial + roadmap update — (this commit)

Deferred to Phase 14b:

- [ ] Step 5: SQLite memory index with FTS5 + optional sqlite-vec for embedding similarity. Now that 13b hybrid `memory_search` runs in-memory per query, swapping to FTS5-backed storage is purely a performance / scale upgrade and can land independently.
- [ ] Step 7: startup migration prompt. Trivial after Step 6 lands; should detect existing JSONL stores when SQLite mode is configured and suggest the migrate command.

What is usable today:

- Construct `SqliteSessionStore({ databasePath })` or `SqliteTaskFlowStore({ databasePath })` directly in test code or future adapters.
- Both stores satisfy the same interfaces as the existing JSONL stores; the gateway / CLI wiring can be flipped via a future `storage.backend` config knob without changing the consumers.
- The migration path from existing JSONL data lives in Phase 14b; for now the SQLite stores start with empty databases.

## 1. Purpose

Phase 14 migrates all of Vole's persistent stores from JSONL to SQLite. Sessions, TaskFlow records, and the memory index (introduced in Phase 13) all currently use append-only JSONL, which works for tens of records but scales poorly past a few thousand. OpenClaw uses SQLite throughout; aligning here unlocks fast listing, indexed queries, FTS5-backed memory search, and atomic multi-record updates.

This phase depends on Phase 11 (gateway and lanes) for the cross-process safety guarantees that make a shared SQLite file workable. It optionally depends on Phase 13 for the memory package whose index this phase ports.

## 2. Scope

This phase includes:

- Add `better-sqlite3` as a dependency; synchronous API and prebuilt binaries keep the install path clean.
- `SqliteSessionStore` in `packages/sessions`, fully compatible with `SessionStore` interface; `JsonlSessionStore` retained as a fallback and for tests.
- `SqliteTaskFlowStore` in `packages/taskflow`, with indexes on `status`, `parentId`, `runtime`, `createdAt`.
- SQLite-backed memory index in `packages/memory`: FTS5 for keyword, blob columns for vectors, optional `sqlite-vec` extension when available.
- `vole migrate jsonl-to-sqlite` command for one-time conversion of existing data.
- Startup detection: when JSONL exists and SQLite does not, print a one-time prompt suggesting migration.
- Schema versioning: a tiny `schema_version` table; future migrations can read it.
- Updated module docs (`packages/sessions`, `packages/taskflow`, `packages/memory`) reflecting SQLite as default.

This phase does not include:

- PostgreSQL or remote database support.
- Sharding or replication.
- A full schema migration framework (one-step version bumps are fine for now).
- Removing the JSONL implementations entirely (kept for testing and emergency export).

## 3. Architecture Summary

### SQLite Backend Choice

`better-sqlite3` is chosen over `node:sqlite` and `sqlite3`:

- Synchronous API matches our existing store interfaces; no awkward async wrappers.
- Prebuilt binaries cover macOS / Linux / Windows; no node-gyp dance for users.
- Strong WAL support pairs with our cross-process file lock.
- Active maintenance and stable performance characteristics.

All stores open the database with `journal_mode=WAL` and `synchronous=NORMAL`. Readers do not block writers.

### Schema and Indexes

Three databases live under `<sessionsDir>/`:

- `sessions.sqlite`: tables `sessions(id PK, agentId, sessionKey UNIQUE, lastActivityAt, ...)`, `messages(id PK, sessionId FK, role, content, createdAt, ...)`, indexes on `(sessionId, createdAt)` and `(agentId, lastActivityAt DESC)`.
- `taskflow.sqlite`: tables `task_records(id PK, runtime, status, parentId, terminalSummary, ...)`, `task_flows(id PK, ...)`, indexes on `status`, `parentId`, `runtime`, `createdAt`.
- `memory-index.sqlite`: FTS5 virtual table over `memory_chunks(file, paragraph, text)`, plus `embeddings(chunkId, model, vector BLOB)`; vector column queried via JS-side dot product unless `sqlite-vec` is loaded.

Foreign keys with `ON DELETE CASCADE` keep cleanup correct.

### Migration Tooling

`vole migrate jsonl-to-sqlite` does the conversion:

1. Refuse to run if any SQLite file already exists (use `--force` to overwrite).
2. Back up existing JSONL to `<sessionsDir>/migrations/<timestamp>/`.
3. Stream JSONL records, insert into SQLite within a single transaction per file.
4. Verify row counts match line counts; abort and restore from backup if mismatched.
5. Print summary with row counts per table.

A `--dry-run` flag reports what would migrate without writing.

### Backwards Compatibility

For one minor version, the stores try SQLite first and fall back to JSONL if SQLite is absent. After that, the readers stop reading JSONL except via the migration command. The fallback period lets users with running daemons cut over without coordinated downtime.

The default store factory is selected by `storage.backend` config (default `"sqlite"`); tests can force `"jsonl"`.

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `session-storage.md` update + zh-CN, `task-flow.md` update + zh-CN, `memory-system.md` update + zh-CN, roadmap update — docs:check must pass.
2. **chore(deps)**: add `better-sqlite3`; verify install across platforms in CI.
3. **feat(sessions)**: `SqliteSessionStore` + tests; both stores selectable by config.
4. **feat(taskflow)**: `SqliteTaskFlowStore` + tests.
5. **feat(memory)**: SQLite memory index with FTS5 and embedding blobs; transparent swap from Phase 13's JSONL index; tests.
6. **feat(cli)**: `vole migrate jsonl-to-sqlite` command with `--dry-run` and `--force`.
7. **feat(cli)**: startup migration prompt.
8. **docs**: mark Phase 14 complete.

## 5. Acceptance Criteria

- `pnpm run check` and `pnpm run check:bundle` pass at every commit.
- A synthetic 10000-session listing benchmark loads in under 50 ms with SQLite (orders-of-magnitude faster than JSONL baseline).
- A round-trip test takes existing JSONL, runs `vole migrate jsonl-to-sqlite`, then reads back identical records.
- Migration backup is created and restorable.
- Cross-process test: two `vole` processes append to the same SQLite store with WAL; no lost writes.
- Memory search with FTS5 matches phrase queries that the keyword regex search missed.
- Setting `storage.backend: "jsonl"` in config restores Phase 13 behavior end-to-end.

## 6. Non-Goals

- No PostgreSQL.
- No remote / networked database.
- No schema migration DSL — single-step bumps only.
- No automatic vacuum or compaction scheduling (manual `vole storage vacuum` is a later option).
- No removal of JSONL stores from the codebase.

## 7. Related Documents

- [Phase 11 Gateway and Lanes](./phase-11-gateway-and-lanes.md)
- [Phase 13 Memory and Prompt Enhancement](./phase-13-memory-and-prompt-enhancement.md)
- [Session Storage](../architecture/session-storage.md)
- [Task Flow](../architecture/task-flow.md)
- [Roadmap](../roadmap/overview.md)

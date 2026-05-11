# Sessions Agent Guide

## Responsibility

Keep short-term conversation records, durable JSONL session storage, durable trace persistence, and the cross-process session file lock here. Runtime code should depend on a session interface instead of knowing storage details. The file lock composes with the in-process session lane in `@vole/lanes`: lane orders writes within one Node process, file lock orders writes across processes.

## When Files Change

Update README and AGENTS files when persistence or locking responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Session logic needs tests for create, append, load, session listing, message and trace ordering, defensive copies, write safety, unsafe session IDs, and replay behavior. File lock logic needs tests for acquisition, idempotent release, timeout when held by a live other process, stale reclaim by dead pid, stale reclaim by age, and in-process serialization. Store-level integration tests must verify the lock file is created and cleaned up around each append.

## Boundaries

Do not assemble prompts, call providers, execute tools, or render CLI output in this package. Do not depend on `@vole/core` or `@vole/lanes` — the file lock is a leaf primitive that any layer can compose with.

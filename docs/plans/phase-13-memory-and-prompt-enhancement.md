# Phase 13: Memory and Prompt Enhancement

Status: Partial (Steps 1, 2, 7 shipped; Steps 3, 4, 5, 6 deferred to Phase 13b)
Date: 2026-05-11

Simplified Chinese version: [phase-13-memory-and-prompt-enhancement.zh-CN.md](./phase-13-memory-and-prompt-enhancement.zh-CN.md)

## Progress

Status: Partial — the foundations are in place; the runtime-invasive steps are deferred to Phase 13b once Phase 14 (SQLite) and Phase 15 (multi-agent identity) land.

Completed commits:

- [x] Step 1: docs(arch) Phase 13 callouts on memory-system / context-compaction / prompt-assembly — `229a608`, `daa9e6c`
- [x] Step 2: feat(memory) extract memory tools into `@vole/memory`; reserved `EmbeddingProvider` interface — `1ef9cd8`
- [x] Step 7: feat(context,cli) `parseInlineDirectives` + `vole compact` info command — `f2b84b9`
- [x] Step 8: docs mark Phase 13 partial + roadmap update — (this commit)

Deferred to Phase 13b:

- [ ] Step 3: hybrid `memory_search` with OpenAI + Voyage adapters. Interface already exported in `@vole/memory`; real adapter wiring + reciprocal rank fusion + index storage pending.
- [ ] Step 4: `DREAMS.md` review workflow. Current `vole run --dream` appends to `MEMORY.md`; needs split into staged `DREAMS.md` + `vole memory review` promotion command.
- [ ] Step 5: pre-compaction memory flush silent turn. `MemoryFlushOptions` already exists on `CompactionOptions`; needs a runtime-side helper that issues a side-channel model call honoring tool execution but discarding the assistant text. Best done after Phase 14 once SQLite makes durable writes cheap.
- [ ] Step 6: six new system prompt sections (Reasoning / Reply Tags / Documentation / Self-Update / Execution Bias / Current Date & Time). The context assembler architecture supports this trivially but each section needs careful prompt-engineering review.

## 1. Purpose

Phase 13 closes three OpenClaw-alignment gaps that were surfaced during the second-pass audit: keyword-only memory search, missing DREAMS.md promotion workflow, and an incomplete system prompt that lacks reasoning, reply tag, documentation, self-update, execution-bias, and current-date sections. It also wires inline directives such as `/think:<level>`, `/stop`, and `/compact` into intake.

Phase 13 is mostly independent of Phase 11's gateway work and may run in parallel with Phase 12. The exception is the new `packages/memory` package, which Phase 14 will later port to SQLite + FTS5.

## 2. Scope

This phase includes:

- New `packages/memory` extracted from the memory tools in `packages/tools`.
- `EmbeddingProvider` interface with auto-detection of OpenAI and Voyage credentials.
- Hybrid `memory_search`: vector top-K plus keyword fallback, score fusion.
- `DREAMS.md` workflow: dreaming output written first to `DREAMS.md` for human review; promotion to `MEMORY.md` requires explicit user action via `vole memory review`.
- Pre-compaction memory flush: a silent system turn before `compactMessages` runs, reminding the agent to record durable facts.
- System prompt section additions: `Reasoning`, `Reply Tags`, `Documentation`, `Self-Update`, `Execution Bias`, `Current Date & Time`.
- Intake-stage inline directive parser: extracts `/think:<level>`, `/stop`, `/compact`, and `NO_REPLY` from user messages and applies them as runtime hints.
- `vole compact` CLI command (user-initiated context compaction).

This phase does not include:

- Embedding providers beyond OpenAI and Voyage (Gemini, Mistral deferred).
- SQLite or FTS5 (Phase 14 replaces the in-memory index).
- Memory-core plugin interface (deferred to Phase 16 with the broader plugin runtime).
- Per-agent memory isolation (Phase 15).

## 3. Architecture Summary

### Hybrid Memory Search

`memory_search` becomes a hybrid retriever:

1. Build / refresh a per-workspace vector index over `MEMORY.md`, `USER.md`, `memory/*.md`. The index lives at `<sessionsDir>/../memory-index/`.
2. On query: embed the query, run vector top-K (default K=10), simultaneously run keyword paragraph search.
3. Fuse scores with reciprocal rank fusion; return top N (default 5).
4. If no embedding provider is configured, silently fall back to keyword-only.

The `EmbeddingProvider` interface stays minimal:

```ts
interface EmbeddingProvider {
  name: "openai" | "voyage";
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

Index storage is JSONL plus a binary `.vec` sidecar in Phase 13; Phase 14 swaps the storage to SQLite + FTS5 + vec extension transparently.

### DREAMS.md and Promotion

Dreaming changes from "rewrite MEMORY.md" to a two-step flow:

1. `vole run --dream` reads recent `memory/YYYY-MM-DD.md` files plus current `MEMORY.md` and writes a *candidate summary* to `DREAMS.md`. Each entry is scored on frequency, recall-diversity, and recency.
2. The user runs `vole memory review` (or opens `DREAMS.md`) to approve or reject promotions. Approved items are appended to `MEMORY.md`; rejected items are archived under `DREAMS/archive/`.

This restores the reviewability OpenClaw documents but never bypasses user consent.

### Pre-Compaction Memory Flush

Before `compactMessages` runs, the runtime inserts a silent system turn:

> "Before this conversation is compressed, write any durable facts the user will care about across sessions to MEMORY.md via `append_daily_memory`."

The model gets one turn to act. Tool calls during this turn count against the normal step limit but do not emit `assistant_message_created` to the user. If the user has disabled long-term memory writes, the flush is skipped.

Configurable via `compaction.memoryFlush.enabled` (default true).

### Prompt Section Completion and Inline Directives

`ContextAssembler` gains six new section builders. The default order matches OpenClaw:

```text
identity → runtime → current-date → tooling → execution-bias → safety
  → reasoning → reply-tags → skills → workspace → documentation
  → self-update → conversation-history → user-message
```

Inline directive parser runs at intake (before context assembly):

| Token | Effect |
| --- | --- |
| `/think:<level>` | Sets per-run `thinkingBudget` |
| `/stop` | Cancels current run via `GatewayCore.cancel` |
| `/compact` | Forces immediate compaction before next turn |
| `NO_REPLY` (assistant output) | Suppresses subagent announcement to parent |

Tokens are stripped from the user-visible message before the model sees it.

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `memory-system.md` update + zh-CN, `context-compaction.md` update + zh-CN, `prompt-assembly.md` update + zh-CN, roadmap update — docs:check must pass.
2. **feat(memory)**: new `packages/memory`; move memory tools out of `packages/tools` keeping the same exports; tests.
3. **feat(memory)**: `EmbeddingProvider` + OpenAI + Voyage adapters; hybrid index; updated `memory_search`; tests.
4. **feat(scheduler,cli)**: `vole run --dream` writes to `DREAMS.md`; `vole memory review` command.
5. **feat(core,context)**: pre-compaction memory flush silent turn.
6. **feat(context)**: six new system prompt sections.
7. **feat(core)**: inline directive parser; `vole compact` CLI command.
8. **docs**: mark Phase 13 complete.

## 5. Acceptance Criteria

- `pnpm run check` passes at every commit.
- A synthetic memory corpus test verifies that a semantically related query (no shared keywords) returns the relevant paragraph.
- With no embedding credentials configured, `memory_search` returns keyword results without errors.
- `vole run --dream` produces `DREAMS.md`; running it twice with no new content produces zero new entries.
- `vole memory review` lists pending DREAMS entries and accepts approval / rejection.
- A long-conversation test shows the pre-compaction silent turn fires before compaction and the model calls `append_daily_memory` in response.
- System prompt inspection shows all 14 sections present and in the documented order.
- A user message containing `/think:max` sets that run's thinking budget without leaking the directive to the assistant.

## 6. Non-Goals

- No Gemini or Mistral embedding adapters.
- No SQLite / FTS5 storage (Phase 14).
- No memory-core plugin interface (Phase 16).
- No per-agent isolated memory directories.
- No semantic dedup of `MEMORY.md` content.

## 7. Related Documents

- [Memory System](../architecture/memory-system.md)
- [Context Compaction](../architecture/context-compaction.md)
- [Prompt Assembly](../architecture/prompt-assembly.md)
- [OpenClaw Alignment Plan](./openclaw-alignment.md)
- [Roadmap](../roadmap/overview.md)

# Vole Agent — Module Learning Plan

**Start here:** [Learning Guide](./guide.md) — the stage-based curriculum.
**Module template:** [_template.md](./_template.md) — the standard format for every module doc.

A structured deep-dive into every module of the Vole TypeScript monorepo.
Each session covers one module: we read the source together, discuss design decisions,
connect the implementation to OpenClaw patterns, and summarize findings into a
dedicated module document.

---

## How Each Session Works

1. **Read the public interface** — exported types reveal what the module promises
2. **Read the tests** — tests are the honest usage documentation
3. **Walk the implementation** — follow the core logic path
4. **Connect to OpenClaw** — where does this fit in the reference architecture?
5. **Summarize** — produce `docs/learning/NN-<module>.md` + Chinese version

---

## Learning Path

Ordered by dependency: each module only uses concepts from modules above it.

| # | Module | Source lines | Key concept | Doc |
|---|--------|-------------|-------------|-----|
| 01 | `@vole/config` | 377 | Env loading, config shape, redaction | ⬜ |
| 02 | `@vole/models` | 871 | Provider abstraction, streaming, token counting | ⬜ |
| 03 | `@vole/permissions` | 82 | Allow / ask / deny / block decision tree | ⬜ |
| 04 | `@vole/tools` | 1182 | Tool registration, execution, workspace sandbox | ⬜ |
| 05 | `@vole/sessions` | 436 | Message persistence, mutex, history compaction | ⬜ |
| 06 | `@vole/taskflow` | 103 | In-turn task tracking, todo state machine | ⬜ |
| 07 | `@vole/context` | 272 | Prompt assembly, XML sections, cache hints | ⬜ |
| 08 | `@vole/skills` | 384 | Skill discovery, lazy loading, frontmatter routing | ⬜ |
| 09 | `@vole/scheduler` | 207 | Cron-based background runs, trigger lifecycle | ⬜ |
| 10 | `@vole/adapters` | 123 | Tool profiles (coding / full / messaging) | ⬜ |
| 11 | `@vole/core` | 855 | **Agent loop** — the heart of everything | ⬜ |
| 12 | `@vole/gateway` | 49 | Session lifecycle, concurrent-run guard | ⬜ |
| 13 | `apps/cli` | 1597+514 | CLI adapter, Ink rendering, slash commands | ⬜ |
| 14 | `apps/web` | — | Web adapter, SSE streaming, REST API | ⬜ |

---

## Module Summaries (one-line purpose)

| Module | What it does |
|--------|-------------|
| `config` | Reads env vars → validated, typed, redaction-safe config object |
| `models` | Wraps Anthropic / OpenAI / OpenRouter into a single `ModelProvider` interface |
| `permissions` | Maps (tool, path) → allow / ask / deny / block; no business logic |
| `tools` | Shell, file I/O, search, edit — the agent's hands |
| `sessions` | Serialises conversation history to disk; one mutex per session |
| `taskflow` | Tracks `TodoItem[]` inside a turn; update_todos tool writes here |
| `context` | Assembles system prompt + message array the model actually sees |
| `skills` | Loads `.md` skill files on demand; builds the `<skills>` index |
| `scheduler` | Persists cron triggers; fires background `AgentRuntime` runs |
| `adapters` | Selects which tools to instantiate based on VOLE_TOOL_PROFILE |
| `core` | 17-event async generator loop: plan → tool call → observe → repeat |
| `gateway` | Creates / resumes sessions; prevents concurrent runs |
| `apps/cli` | Terminal UI (Ink), slash commands, streaming output, permission prompts |
| `apps/web` | HTTP + SSE server; browser client in React |

---

## Themes to Track Across All Modules

- **OpenClaw alignment** — what pattern from OpenClaw does this implement?
- **Boundary discipline** — what is explicitly NOT this module's responsibility?
- **Event / data contracts** — what types cross module boundaries?
- **Testability approach** — how are external dependencies faked in tests?

---

## Progress

| # | Module | Status |
|---|--------|--------|
| 01 | config | ⬜ not started |
| 02 | models | ⬜ not started |
| 03 | permissions | ⬜ not started |
| 04 | tools | ⬜ not started |
| 05 | sessions | ⬜ not started |
| 06 | taskflow | ⬜ not started |
| 07 | context | ⬜ not started |
| 08 | skills | ⬜ not started |
| 09 | scheduler | ⬜ not started |
| 10 | adapters | ⬜ not started |
| 11 | core | ⬜ not started |
| 12 | gateway | ⬜ not started |
| 13 | apps/cli | ⬜ not started |
| 14 | apps/web | ⬜ not started |

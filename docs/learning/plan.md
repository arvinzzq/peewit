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
| 15 | `@vole/lanes` | 142 | FIFO queue with concurrency cap; three-tier admission | ⬜ |

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
| `lanes` | FIFO admission primitive; three tiers (global / subagent / session) the gateway composes |

---

## Themes to Track Across All Modules

- **OpenClaw alignment** — what pattern from OpenClaw does this implement?
- **Boundary discipline** — what is explicitly NOT this module's responsibility?
- **Event / data contracts** — what types cross module boundaries?
- **Testability approach** — how are external dependencies faked in tests?

---

## Stage Progress

| Stage | Topic | Status | Doc |
|---|---|---|---|
| Stage 1 | Agent Loop Mental Model | ✅ complete | [01-concepts.md](./01-concepts.md) |
| Stage 2 | Core Loop in Code | ✅ complete | [02-core.md](./02-core.md) |
| Stage 3 | Foundation Modules | ✅ complete | 03-config, 04-models, 05-permissions, 06-tools, 08-sessions, 09-taskflow, 07-context, 10-skills, 11-scheduler |
| Stage 4 | Extension Systems | ✅ complete (Phase 11 adds 16-lanes; 13-gateway rewrite pending Phase 11 Step 3) | 12-adapters, 13-gateway, 16-lanes |
| Stage 5 | System Synthesis | ✅ complete | 14-cli, 15-web |

## Module Progress

| # | Module | Status | Doc |
|---|--------|--------|-----|
| 01 | config | ✅ complete | [03-config.md](./03-config.md) |
| 02 | models | ✅ complete | [04-models.md](./04-models.md) |
| 03 | permissions | ✅ complete | [05-permissions.md](./05-permissions.md) |
| 04 | tools | ✅ complete | [06-tools.md](./06-tools.md) |
| 05 | sessions | ✅ complete | [08-sessions.md](./08-sessions.md) |
| 06 | taskflow | ✅ complete | [09-taskflow.md](./09-taskflow.md) |
| 07 | context | ✅ complete | [07-context.md](./07-context.md) |
| 08 | skills | ✅ complete | [10-skills.md](./10-skills.md) |
| 09 | scheduler | ✅ complete | [11-scheduler.md](./11-scheduler.md) |
| 10 | adapters | ✅ complete | [12-adapters.md](./12-adapters.md) |
| 11 | core | ✅ complete | [02-core.md](./02-core.md) |
| 12 | gateway | ✅ complete | [13-gateway.md](./13-gateway.md) |
| 13 | apps/cli | ✅ complete | [14-cli.md](./14-cli.md) |
| 14 | apps/web | ✅ complete | [15-web.md](./15-web.md) |
| 15 | lanes | ✅ complete | [16-lanes.md](./16-lanes.md) |

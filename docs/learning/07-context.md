# Module 06: @vole/context

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `07-context.zh-CN.md` (create alongside this file)

Related source: `packages/context/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [06-tools.md](./06-tools.md) — tools contribute their summaries to context,
and you already know why `ContextToolSummary` only has `name`, `description`, and `risk`.

**Before reading**: Read `packages/context/src/index.ts` in full. Focus on what each
section name means (`identity`, `runtime`, `tooling`, `safety`, `skills`, `workspace`).

**Focus questions**:
- What is in each XML section of the system prompt?
- Why does `ContextSkillSummary` only have `name` and `description`, not the skill body?
- What is a `ContextAssemblyReport` and why does it exist?
- How does `compactMessages` work, and what happens when compaction fails?

**Checkpoint**: You understand this module when you can describe the full system prompt
that would be assembled for a `full` mode run with 3 registered tools and 2 skills.

## 1. What This Module Does

**Plain language**: Think of `@vole/context` as a secretary who prepares the briefing
document before every meeting with the model. Before each model call, the secretary
assembles a packet:

- **Who you are** (identity section — the system instruction)
- **Your current situation** (runtime — mode, workspace path, today's date)
- **What tools you have** (tooling — name, risk level, description for each)
- **The safety rules** (safety — the permission guidance text)
- **What skills are available** (skills — compact index only, not full bodies)
- **Workspace instructions** (workspace — AGENTS.md, SOUL.md, etc.)
- **Previous conversation** (message history)
- **What the user wants now** (the current user message)

The secretary also writes a record of what was included and what was left out, and why
(the assembly report). This record helps with debugging and tracing.

**Technical summary**: `@vole/context` assembles the `ModelInput` that is sent to the
model provider on each loop step. It formats the system prompt as XML-tagged sections,
applies prompt mode (full / minimal / none), loads workspace prompt files, and can
compact long message histories using the model provider itself.

## 2. Why It Exists

Without a dedicated assembly layer, every adapter would format its own system prompt.
Prompts would drift between CLI, web, and background runs. System prompt structure would
be hardcoded in core logic, making it impossible to test independently.

`@vole/context` creates a single, auditable step where "here is all the information" becomes
"here is the model-ready payload." Core calls `assembler.assemble(input)` and gets back
`{ modelInput, report }` — it never sees the XML formatting logic.

## 3. Public Interface

```ts
interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>
}

interface ContextAssemblyInput {
  systemInstruction: string        // the base identity text
  runtime?: ContextRuntimeMetadata // mode, workspace, currentDate
  tools?: ContextToolSummary[]     // name, description, risk — no inputSchema
  skillIndex?: ContextSkillSummary[] // name, description only — no skill body
  permissionGuidance?: string      // text for the <safety> section
  recentMessages?: ModelMessage[]  // conversation history
  userMessage: string              // the current user message
  promptMode?: PromptMode          // "full" | "minimal" | "none"
}

interface ContextAssemblyResult {
  modelInput: ModelInput            // ready to send to ModelProvider
  report: ContextAssemblyReport     // what was included and omitted
}

type PromptMode = "full" | "minimal" | "none"

// Compaction utility — not part of the assembler interface
async function compactMessages(
  messages: ModelMessage[],
  modelProvider: ModelProvider,
  options?: Partial<CompactionOptions>
): Promise<ModelMessage[]>
```

## 4. Implementation Walkthrough

`DefaultContextAssembler.assemble()` builds the system prompt section by section:

**`promptMode: "none"`** — skips all sections, returns only messages + user input. No
system message is added to `modelInput.messages`.

**`promptMode: "minimal"` or `"full"`** — always adds the `<identity>` section:
```
<identity>
{systemInstruction}
</identity>
```

**`promptMode: "full"` additionally adds** (when the relevant input is present):

| Section | XML tag | Content |
|---|---|---|
| Runtime context | `<runtime>` | Mode, workspace path, current date |
| Tool listing | `<tooling>` | One line per tool: `- name [risk]: description` |
| Permission guidance | `<safety>` | The permission guidance text from core |
| Skill index | `<skills>` | One line per skill: `- name: description` |
| Workspace files | `<workspace>` | Contents of AGENTS.md, SOUL.md, etc. |

Each section produces a `ContextSectionReport` that records whether it was included and
why it was omitted if not (e.g., "No tools registered.", "No skills loaded.").

The final `modelInput.messages` array is:
```
[
  { role: "system", content: "<identity>...</identity>\n<runtime>...</runtime>..." },
  ...recentMessages,
  { role: "user", content: userMessage }
]
```

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| `bootstrap-prompt.ts` | `DefaultContextAssembler` | System prompt assembly |
| `<identity>` / `<tooling>` XML sections | Same tag names | Aligned structure |
| Prompt modes (`full`, `minimal`, `none`) | `PromptMode` type | Same modes |
| Workspace bootstrap files (`AGENTS.md` etc.) | `workspacePromptFiles` config | Same concept |
| Skills index in system prompt | `skillIndex?: ContextSkillSummary[]` | Same progressive disclosure |
| Context engine compaction | `compactMessages()` | OpenClaw uses plugin-based engines; Vole uses a simpler built-in |

## 6. Key Design Decisions

**XML-tagged sections, not plain text**

The system prompt uses named XML tags (`<identity>`, `<tooling>`, etc.) rather than
prose headings. This gives the model clear structural boundaries between sections. The
model can reliably distinguish "this is the tool list" from "this is the safety guidance"
without depending on prose formatting that could vary.

**`ContextSkillSummary` has only name and description — no body**

The full `SKILL.md` content (potentially several thousand words) is never included in
context. The `<skills>` section contains only a one-line entry per skill:
`- skill-name: description text`.

When the model decides a skill is relevant, it calls `load_skill("skill-name")` to
fetch the full body on demand. This is progressive disclosure: skills cost ~100 tokens
in the index, nothing until triggered, then full body loaded once per turn.

**`ContextAssemblyReport` makes assembly observable**

Every `assemble()` call returns a `report` alongside `modelInput`. The report lists which
sections were included and which were omitted with reasons. Core emits this information
in the `context_assembled` event. This means trace viewers can show "the model saw these
sections" without having to parse the raw system prompt.

**Compaction is distillation, not summarisation**

Compaction and summarisation have different goals. Summarisation produces a readable
overview for a human. Compaction extracts the operationally necessary information for
the agent to continue working: tool calls and their outcomes, decisions reached, key
facts discovered, files modified, errors encountered, current task state. These are
what the next loop step needs — not highlights for a reader.

`compactMessages()` uses a two-phase approach inspired by Claude Code's prioritised
context cleanup strategy:

**Phase 1 — mechanical reduction (free, no model call)**
Tool result messages in the old portion are replaced with summary-only versions via
`thinToolMessage()`. Tool outputs (file contents, shell stdout, web pages) are the
largest context consumers but only their summary matters once the agent has moved past
them. Replacing `{ ok: true, content: "...5000 chars..." }` with
`{ ok: true, summary: "Read foo.ts." }` before distillation makes the Phase 2 call
cheaper and keeps the resulting summary focused on decisions rather than raw data.

**Phase 2 — semantic reduction (one model call)**
The thinned old messages are distilled into a compact summary using `modelProvider`.
The same `ModelProvider` interface used by the agent loop is reused — no special API.

**Failure handling**: If Phase 2 fails (network error, model error), the Phase 1
thinned messages are returned — not the originals. Tool output content is never
restored to context after a failed Phase 2 call. This means compaction always
reduces context size even on failure — the thinned messages are smaller than the originals.

**Workspace files are loaded fresh on every call**

`#loadWorkspacePromptSections()` reads workspace prompt files (AGENTS.md, etc.) from disk
on every `assemble()` call. There is no caching. This ensures the agent always sees the
latest version of workspace instructions. If a file does not exist, it is silently skipped
(`ENOENT` is caught and ignored). Other filesystem errors are propagated.

## 7. Testing Approach

Tests are in `packages/context/src/index.test.ts`. All workspace file loading is tested
via the injectable `readWorkspaceFile` dependency — no real disk access needed.

Test categories:
- Full mode: all sections present when input is complete
- Minimal mode: only identity section, no tooling/skills/safety/workspace
- None mode: no system message at all
- Missing optional fields: sections omitted with correct reasons in report
- `ContextAssemblyReport` content and structure
- Compaction: trigger threshold, system message preserved, summary replaces old messages, recent messages verbatim
- Phase 1 thinning: tool outputs replaced with summaries in old portion
- Compaction failure: thinned messages returned (not originals)
- Recent messages verbatim: large tool outputs in recent portion are never thinned

## 8. Insights

**The system prompt is rebuilt fresh on every loop step.** There is no caching between
iterations. Each time `runTurn` calls `assemble()`, the full prompt is reconstructed.
This is necessary because the skill index, tool list, or workspace files may change
between calls, and the model must always see a consistent current state.

**`ContextToolSummary` deliberately excludes `inputSchema`.** Tools include a JSON
schema for input validation, but the assembler only sends `name`, `description`, and
`risk` to the model. The model does not need the schema to decide which tool to call —
it needs the description. The schema is sent separately as part of `ModelInput.tools`
(the tool definitions array), handled by `AgentRuntime`, not by the assembler.

**`promptMode: "none"` enables minimal-overhead background runs.** When a background
scheduler fires a pre-configured task, a large system prompt describing tools, skills,
and workspace context may be unnecessary. `"none"` mode allows running the model
with only the task message, reducing token cost.

**Compaction is distillation, not summarisation.** Summarisation produces a human-readable
overview of what happened. Compaction extracts the operationally necessary information for
the agent to continue: tool calls made, decisions reached, key facts discovered, current
task state. What a human might find interesting to review is often irrelevant to what the
agent needs to carry forward. The distinction matters: compaction is not a recap for the
user — it is a memory reduction for the next loop step.

**The leading system message is protected from compaction.** The system message
(containing `<identity>`, `<tooling>`, `<safety>`, `<skills>`) must survive compaction
intact. Without protection, the agent loses its permission guidance and skill index after
enough conversation history accumulates. `compactMessages` always preserves `messages[0]`
when its role is `"system"`, placing it before the distillation summary in the result.

**Recent messages are always preserved verbatim.** The last `keepRecent` (default 12)
conversation messages are never thinned or summarised. They represent the agent's current
working memory and must not be altered — the model relies on them to know what just happened.
Large tool outputs that fall within the recent portion are kept exactly as-is.

**Tool outputs are the biggest context consumers.** A single file read or shell command
can produce thousands of tokens of output. Once the agent has processed a tool result and
moved on, the raw output adds no value. `thinToolMessage()` replaces large tool result
content with just the `summary` field ("Read foo.ts.", "Ran in 234ms exit 0.") before
building the distillation transcript, making the compaction call much cheaper.

**Compaction summary becomes a system message.** The distilled context produced by `compactMessages`
is inserted as `{ role: "system", content: "Conversation summary:\n..." }`. This is the
only summary in the compacted history — the original system prompt from the current
`assemble()` call is prepended separately.

## 9. Review Questions

1. What are the six named sections of a `full` mode system prompt? What goes in each?
   > `<identity>`: the base system instruction. `<runtime>`: mode, workspace path, date.
   > `<tooling>`: one line per tool with name, risk, description. `<safety>`: permission
   > guidance text. `<skills>`: compact index with name and description per skill.
   > `<workspace>`: contents of workspace prompt files (AGENTS.md, SOUL.md, etc.).

2. Why does `ContextSkillSummary` contain only `name` and `description`, not the full
   skill body?
   > Progressive disclosure. Full skill bodies can be several thousand words each. Including
   > all of them in every prompt would be expensive. The model reads the compact index to
   > decide if a skill is relevant, then calls `load_skill()` to fetch the full body only
   > when needed. Skills cost ~100 tokens in the index, zero until triggered.

3. What is the `ContextAssemblyReport` and why does it exist?
   > A record of which sections were included and which were omitted (with reasons) in a
   > given `assemble()` call. It makes context assembly observable — trace viewers and
   > adapters can show "the model saw identity, tooling, and safety, but no skills were
   > loaded" without parsing the raw system prompt string.

4. When does `compactMessages()` trigger? What does the compacted history look like?
   > Triggers when `estimateMessageTokens(messages) > maxTokens` (default 60 000) **or**
   > `messages.length > maxMessages` (default 400, a safety fallback). Token count is
   > estimated as `ceil(totalChars / 4)` — a chars-per-token heuristic, no API call.
   > The oldest messages are summarized into a single
   > `{ role: "system", content: "Conversation summary:\n..." }` message. The most
   > recent `keepRecent` (default 12) messages are preserved verbatim.
   > The result is `[summary system message, ...recent 12 messages]`.

5. What happens when `compactMessages()` fails — e.g., the model provider returns an error?
   > The Phase 1 thinned messages are returned — not the original messages. Phase 1 already
   > replaced large tool result content with summary-only versions. Compaction failure is
   > silent and non-fatal. The agent continues with the thinned (but not fully distilled)
   > history. Tool output content is never restored after a failed Phase 2 call.

6. Why is the system prompt rebuilt on every `assemble()` call rather than cached?
   > Skills, tools, and workspace files could change between calls. Caching would mean the
   > model might act on stale instructions. Fresh assembly guarantees the model always sees
   > current state. The cost is rebuilding XML formatting on each call — acceptable given
   > the payload is sent over the network anyway.

7. In a `minimal` prompt mode call, what is in `modelInput.messages`?
   > `[{ role: "system", content: "<identity>...</identity>" }, ...recentMessages,
   > { role: "user", content: userMessage }]`. Only the identity section is included.
   > Runtime, tooling, safety, skills, and workspace sections are all omitted.

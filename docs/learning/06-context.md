# Module 06: @vole/context

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `06-context.zh-CN.md` (create alongside this file)

Related source: `packages/context/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [05-tools.md](./05-tools.md) — tools contribute their summaries to context,
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

**Compaction uses the model provider itself**

`compactMessages()` calls `modelProvider.generate()` to produce a summary. No special
summarization API is needed — the same `ModelProvider` interface used by the agent loop
is reused here. If compaction fails (network error, model error), the original messages
are returned unchanged. The agent continues; compaction failure is silent and non-fatal.

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
- Compaction: trigger threshold, summary replaces old messages, recent messages preserved
- Compaction failure: original messages returned when provider errors

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

**Compaction summary becomes a system message.** The summary produced by `compactMessages`
is inserted as `{ role: "system", content: "Conversation summary:\n..." }`. This is the
only system message in the compacted history — the original system prompt from the current
`assemble()` call is added separately at the start of `modelInput.messages`.

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
   > Triggers when `messages.length > maxMessages` (default 30). The oldest messages
   > are summarized into a single `{ role: "system", content: "Conversation summary:\n..." }`
   > message. The most recent `keepRecent` (default 12) messages are preserved verbatim.
   > The result is `[summary system message, ...recent 12 messages]`.

5. What happens when `compactMessages()` fails — e.g., the model provider returns an error?
   > The original `messages` array is returned unchanged. Compaction failure is silent and
   > non-fatal. The agent continues with the full uncompacted history.

6. Why is the system prompt rebuilt on every `assemble()` call rather than cached?
   > Skills, tools, and workspace files could change between calls. Caching would mean the
   > model might act on stale instructions. Fresh assembly guarantees the model always sees
   > current state. The cost is rebuilding XML formatting on each call — acceptable given
   > the payload is sent over the network anyway.

7. In a `minimal` prompt mode call, what is in `modelInput.messages`?
   > `[{ role: "system", content: "<identity>...</identity>" }, ...recentMessages,
   > { role: "user", content: userMessage }]`. Only the identity section is included.
   > Runtime, tooling, safety, skills, and workspace sections are all omitted.

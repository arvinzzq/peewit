# Context Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/context` owns **provider-neutral context assembly**. Its job is to decide what the model sees before any provider-specific formatting happens. It accepts raw inputs (system instruction, runtime metadata, tool summaries, skill index, permission guidance, conversation history, user message) and produces a `ModelInput` ready for any `ModelProvider`.

The package has no awareness of which model is selected, which adapter is rendering, or what tools are actually doing. It only arranges named sections into a system prompt and constructs a flat message array.

```
ContextAssembler.assemble(input)
  │
  ├─ section: identity      (always included in full/minimal)
  ├─ section: runtime       (full only, if runtime metadata provided)
  ├─ section: tooling       (full only, if tools registered)
  ├─ section: safety        (full only, if permissionGuidance provided)
  ├─ section: skills        (full only, if skillIndex populated)
  ├─ section: workspace     (full only, from AGENTS.md / SOUL.md files)
  ├─ messages: conversation_history  (from recentMessages)
  └─ messages: user_message
  │
  ▼
ModelInput + ContextAssemblyReport
```

## Core Concepts

### Named Sections and Deterministic Ordering

The system prompt is assembled from named sections in a fixed order. Each section is wrapped in an XML-style tag (e.g. `<identity>…</identity>`) so the model can unambiguously locate each piece of guidance. The order never changes: identity → runtime → tooling → safety → skills → workspace.

This determinism is essential for:
1. **Predictable model behavior**: the model always finds instructions in the same position.
2. **Testable assembly**: tests assert specific section content and ordering.
3. **Inspectable output**: `ContextAssemblyReport` records which sections were included or omitted and why.

### PromptMode

Three modes control how much of the system prompt is assembled:

| Mode | identity | runtime + tooling + safety + skills + workspace | Use when |
|---|---|---|---|
| `"full"` | ✓ | ✓ | Normal interactive sessions |
| `"minimal"` | ✓ | ✗ | Lightweight tasks that don't need tool or skill context |
| `"none"` | ✗ | ✗ | Utility calls (summarization, classification) that need no agent framing |

In `"none"` mode, no system message is emitted at all — only the conversation history and user message.

### MinimalContextAssembler

`MinimalContextAssembler` is the null implementation of `ContextAssembler`. It produces a system message from `systemInstruction` (if provided) and appends `recentMessages` + `userMessage` directly — no XML formatting, no workspace file reads, no section structure.

Use it when testing tool dispatch, permission evaluation, or agent loop behavior in isolation, without needing to verify context assembly. It is the default assembler used by `createAgent()` when no `context` option is provided.

### ContextAssemblyReport

Every `assemble()` call returns a `ContextAssemblyReport` alongside the `ModelInput`. The report lists:
- `includedSections`: names of sections that were included.
- `omittedSections`: names of sections that were skipped, with a `reason` string.

`AgentRuntime` uses `report.includedSections.includes("identity")` to populate the `context_assembled` event. Adapters and tests can inspect the report without re-parsing the system prompt.

### Workspace Prompt Files

`DefaultContextAssembler` accepts a `workspacePromptFiles` array (e.g. `["AGENTS.md", "SOUL.md"]`) and a `readWorkspaceFile` callback (defaulting to `fs.readFile`). During assembly, it reads each file from `{runtime.workspace}/{fileName}`, skips `ENOENT` errors, and injects non-empty files into the `<workspace>` section as named subsections. This allows per-project and per-user instruction files to be picked up automatically.

### compactMessages

`compactMessages(messages, provider, options?)` prevents the context window from overflowing during long agent runs. When `messages.length > maxMessages` (default: 30), it:

1. Splits messages into `old` (all but the last `keepRecent`) and `recent` (last `keepRecent`, default: 12).
2. Formats the `old` messages as a plain transcript.
3. Calls the model provider to generate a factual summary of the transcript.
4. Returns `[{ role: "system", content: "Conversation summary:\n…" }, ...recent]`.

If the model call fails for any reason, the original message array is returned unchanged (safe degradation). The summary is injected as a system message so the model understands it is reading a summary, not original dialogue.

## Implementation Principles

### Section Assembly Algorithm

```typescript
// Pseudocode for full mode
const parts: string[] = [];

parts.push(`<identity>\n${systemInstruction}\n</identity>`);

if (runtime) {
  parts.push(`<runtime>\n- Mode: …\n- Workspace: …\n- Date: …\n</runtime>`);
}

if (tools.length > 0) {
  const toolLines = tools.map(t => `- ${t.name} [${t.risk}]: ${t.description}`).join("\n");
  parts.push(`<tooling>\n${toolLines}\n</tooling>`);
}

// … safety, skills, workspace …

return {
  modelInput: {
    messages: [
      { role: "system", content: parts.join("\n") },
      ...recentMessages,
      { role: "user", content: userMessage }
    ]
  },
  report: { … }
};
```

The context package does not know the model's token limit. Overflow prevention is the responsibility of `compactMessages` (called by the runtime before each model step) or the adapter.

### Why Tool Summaries Instead of Definitions

The context package receives `ContextToolSummary[]` (name + description + risk) rather than full `ModelToolDefinition` objects. This keeps the context package decoupled from tool schema details. The runtime converts `ExecutableTool[]` → `ContextToolSummary[]` for context assembly, and separately converts `ExecutableTool[]` → `ModelToolDefinition[]` for the model API call.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares context package exports and dependency on models (for `ModelInput`, `ModelMessage`, `ModelProvider`). |
| `tsconfig.json` | TypeScript config | Builds context with a project reference to models. |
| `src/index.ts` | Context assembler | All exports: `ContextAssembler`, `DefaultContextAssembler`, `MinimalContextAssembler`, `ContextAssemblyInput/Result/Report`, `ContextRuntimeMetadata`, `ContextToolSummary`, `ContextSkillSummary`, `PromptMode`, `compactMessages`, `CompactionOptions`, `DEFAULT_COMPACTION_OPTIONS`. |
| `src/index.test.ts` | Context tests | Protects section ordering, section inclusion/omission per prompt mode, tooling/safety/skills format, workspace file loading, assembly reports, and `compactMessages` compaction behavior. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

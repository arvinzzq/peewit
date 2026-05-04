# Phase 3: Context Assembly and Skills

Status: Draft
Date: 2026-05-04

Simplified Chinese version: [phase-3-context-assembly-and-skills.zh-CN.md](./phase-3-context-assembly-and-skills.zh-CN.md)

## Progress

Status: In Progress

Completed:

- Part A: Context section architecture.
  - Named sections: identity, runtime, tooling, safety, skills, workspace, conversation_history, user_message.
  - `ContextToolSummary`, `ContextSkillSummary`, `ContextSectionReport` types added to `packages/context`.
  - `ContextAssemblyInput` extended with `tools?`, `skillIndex?`, `permissionGuidance?`.
  - `ContextAssemblyReport` extended with `sections: ContextSectionReport[]`.
  - `AgentRuntime` projects tools to `ContextToolSummary[]` and passes default permission guidance each turn.
  - All tests pass.

Remaining:

- Part B: Anthropic provider.
- Part C: Skill loader and SKILL.md parser.
- Part C: Skill index injection into context assembler.
- Part C: CLI /skills command.
- Documentation pass.

Next recommended slice:

- Part B: Add `@anthropic-ai/sdk` to `packages/models` and implement `AnthropicProvider`.

## 1. Purpose

Phase 3 closes the gap between what the architecture documents describe and what the implementation delivers, then builds the lightweight skill system on top of that foundation.

Two tightly coupled goals:

1. Bring context assembly to the level described in `context-engine.md` and `prompt-assembly.md`: section-based system prompt, tool descriptions visible to the model, permission guidance, skill index.
2. Implement the lightweight skill system that plugs into the section architecture.

These goals are coupled because skills inject a compact index into the context assembler's skills section. Without the section architecture, skills have no clean insertion point.

Phase 3 also addresses a Phase 2 gap: tool definitions currently bypass the context assembler entirely. The runtime converts tools directly to `ModelToolDefinition[]` and passes them to `ModelInput.tools`. The context assembler knows nothing about available tools. Phase 3 fixes this by passing tool summaries through the assembler so the model receives both a human-readable tooling section in the system prompt and a structured tool schema via the API parameter.

OpenClaw alignment note:

Phase 3 brings ArvinClaw to parity with OpenClaw's core prompt assembly concept: each model call receives a structured context document with explicit, named sections. Skills, tools, and safety guidance are first-class sections, not afterthoughts.

Reference: [Prompt Assembly](../architecture/prompt-assembly.md), [Context Engine](../architecture/context-engine.md), [Skill System](../architecture/skill-system.md)

## 2. User Result

After Phase 3:

- The agent's system prompt has named sections for identity, runtime, tooling, safety, skills, and workspace.
- The model knows what tools are available through a tooling section, not just via API schemas.
- Users can place a `SKILL.md` file in `<workspace>/skills/` and the agent will load it.
- The agent consults compact skill guidance in every model call.
- `/skills` in the chat lists loaded skills.
- Claude can be used directly by setting `ANTHROPIC_API_KEY`.
- `/trace` or the context assembly report shows which sections were included.

## 3. Scope

Phase 3 includes:

- Section-based context assembly in `packages/context`.
- `ContextToolSummary` and `ContextSkillSummary` types.
- Tool summaries passed from `AgentRuntime` to context assembler.
- Permission guidance section in system prompt.
- Skill index section in system prompt.
- `packages/skills` implementation: scanner, SKILL.md parser, precedence.
- Built-in skills: research, project-inspector, safe-shell.
- CLI `/skills` slash command.
- Anthropic provider in `packages/models`.
- Config extension for Anthropic API key and provider selection.

Phase 3 does not include:

- Context compaction.
- Full SKILL.md body loading on demand during a run.
- Streaming model output.
- Skill marketplace or remote skill installation.
- Memory writes.
- Provider routing or fallback.
- Skill permission declarations.

## 4. Architecture Added

### 4.1 Context Section Architecture

`packages/context` gains a section concept:

```typescript
export interface ContextSection {
  name: string;
  content: string;
}
```

`ContextAssemblyInput` gains new optional inputs:

```typescript
export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  tools?: ContextToolSummary[];
  skillIndex?: ContextSkillSummary[];
  permissionGuidance?: string;
  recentMessages?: ModelMessage[];
  userMessage: string;
}

export interface ContextToolSummary {
  name: string;
  description: string;
  risk: "low" | "medium" | "high" | "blocked";
}

export interface ContextSkillSummary {
  name: string;
  description: string;
  when: string;
}
```

`DefaultContextAssembler` assembles the system prompt from these sections in order:

```
[identity]    systemInstruction
[runtime]     mode, workspace, currentDate
[tooling]     tool name + description + risk for each registered tool
[safety]      permissionGuidance
[skills]      compact skill index (name, when to use)
[workspace]   AGENTS.md, SOUL.md
[memory]      USER.md, MEMORY.md, daily notes (when enabled)
```

`ContextAssemblyReport` gains per-section inclusion details:

```typescript
export interface ContextSectionReport {
  name: string;
  included: boolean;
  reason?: string;
}

export interface ContextAssemblyReport {
  includedSections: string[];
  omittedSections: string[];
  sections: ContextSectionReport[];
}
```

### 4.2 AgentRuntime Update

`AgentRuntime` converts registered `ExecutableTool[]` to `ContextToolSummary[]` before passing to the context assembler. The assembler produces the tooling section. The runtime continues to produce `ModelToolDefinition[]` for `ModelInput.tools` (the API parameter). Both paths run in parallel.

### 4.3 Anthropic Provider

`packages/models` gains `AnthropicProvider`:

- Uses `@anthropic-ai/sdk`.
- Translates `ModelInput` to Anthropic `messages` format.
- Translates `ModelInput.tools` to Anthropic tool definitions.
- Parses `tool_use` content blocks into `ModelToolCallsOutput`.
- Formats tool results as `tool_result` content blocks.
- Normalizes Anthropic API errors to `ModelErrorOutput`.

Config:

```json
{
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "maxTokens": 4096
  }
}
```

Environment variable:

```text
ANTHROPIC_API_KEY
```

### 4.4 Skill System

`packages/skills` implementation:

- `SkillDefinition`: name, description, when, steps, safety.
- `SkillSummary`: name, description, when (compact, for context index).
- `SkillLoader.load(options)` scans skill directories in precedence order:
  1. `<workspace>/skills/`
  2. `~/.arvinclaw/skills/`
  3. Built-in skills
- SKILL.md format: h1 name, sections for description, when, steps, safety notes.
- Built-in skills: `research`, `project-inspector`, `safe-shell`.

CLI gains a `/skills` slash command that lists loaded skills with name and when.

`AgentRuntime` or CLI composition loads the skill index before each run and passes `ContextSkillSummary[]` to the context assembler.

## 5. Learning Documents

Update:

- `docs/architecture/prompt-assembly.md`
- `docs/architecture/context-engine.md`
- `docs/architecture/model-provider.md`
- `docs/architecture/skill-system.md`
- `docs/decisions/0005-anthropic-provider.md` (new)

## 6. Acceptance Criteria

Phase 3 is complete when:

- Context assembler includes a tooling section with registered tool names, descriptions, and risk levels.
- Context assembler includes a skills section with compact skill index when skills are loaded.
- Context assembler includes a safety section with permission guidance.
- `ContextAssemblyReport` shows which sections were included and which were omitted.
- `AgentRuntime` passes tool summaries to the assembler before each model call.
- Anthropic provider can be selected with `model.provider: "anthropic"` and `ANTHROPIC_API_KEY`.
- SKILL.md files in `<workspace>/skills/` are loaded and appear in the skill index.
- `/skills` slash command lists loaded skills in the CLI.
- Built-in skills are available by default.
- Skills guide agent behavior through the system prompt without bypassing tool or permission systems.
- All tests pass and `pnpm run check` succeeds.

## 7. Non-Goals

- Context compaction.
- Full SKILL.md body loading on demand during a run.
- Streaming model output.
- Skill marketplace or remote skill installation.
- Memory write policy or implementation.
- Provider routing, fallback, or multi-provider configuration.
- Skill permission declarations.

## 8. Planned Work

Recommended order:

### Part A: Context Section Architecture

1. Define `ContextToolSummary` and `ContextSkillSummary` in `packages/context`.
2. Extend `ContextAssemblyInput` with `tools?`, `skillIndex?`, `permissionGuidance?`.
3. Redesign `DefaultContextAssembler` with section-based system prompt assembly.
4. Update `ContextAssemblyReport` with per-section detail.
5. Update `AgentRuntime` to convert registered tools to `ContextToolSummary[]` and pass to assembler.
6. Add default permission guidance string.
7. Update `packages/context` source header, README, AGENTS.
8. Update `packages/core` source header.
9. Add context section tests.

### Part B: Anthropic Provider

1. Add `@anthropic-ai/sdk` to `packages/models` dependencies.
2. Implement `AnthropicProvider` class.
3. Extend `packages/config` with `provider: "anthropic"` option and `ANTHROPIC_API_KEY` env var.
4. Update CLI composition to create `AnthropicProvider` when configured.
5. Add provider tests with fake HTTP.
6. Update `packages/models` and `packages/config` source headers and module docs.

### Part C: Skill System

1. Implement `packages/skills`: `SkillDefinition`, `SkillSummary`, `SkillLoader`.
2. Define SKILL.md format.
3. Add built-in skills: `research`, `project-inspector`, `safe-shell`.
4. Update `AgentRuntime` or CLI composition to load skills before each session.
5. Pass `ContextSkillSummary[]` to context assembler.
6. Add `/skills` slash command to CLI.
7. Update `packages/skills` source header, README, AGENTS.
8. Update `apps/cli` source header, README, AGENTS.
9. Add skill system tests.

### Documentation Pass

1. Update architecture docs to reflect Phase 3 implementation.
2. Update roadmap Phase 3 status.
3. Update README.

## 9. Tests

Required Phase 3 tests:

- Context assembler produces tooling section when tools provided.
- Context assembler omits tooling section when no tools provided.
- Context assembler produces skills section when skill index provided.
- Context assembler omits skills section when no skill index provided.
- Context assembler produces safety section when permission guidance provided.
- Section order is deterministic.
- Context assembly report includes per-section detail.
- Anthropic provider sends correct message format.
- Anthropic provider sends correct tool definitions.
- Anthropic provider parses tool_use blocks as ModelToolCallsOutput.
- Anthropic provider normalizes Anthropic errors.
- Skill loader discovers SKILL.md files in workspace directory.
- Skill loader follows precedence: workspace overrides user overrides built-in.
- SKILL.md parsing extracts name, description, when, steps.
- Skill index summary includes only compact fields.
- CLI /skills lists loaded skills.
- AgentRuntime passes tool summaries to assembler in every turn.
- End-to-end: model receives tooling section in system prompt.

## 10. Commit Plan

Suggested commits:

1. `feat(context): add section architecture and tool/skill summary inputs`
2. `docs: update context assembly docs for section architecture`
3. `feat(core): pass tool summaries to context assembler`
4. `docs: update core docs for context assembly flow`
5. `feat(models): add Anthropic provider`
6. `feat(config): add Anthropic provider configuration`
7. `feat(cli): wire Anthropic provider in composition`
8. `docs: update model provider docs for Anthropic`
9. `feat(skills): add skill loader and SKILL.md parser`
10. `feat(skills): add built-in skills`
11. `feat(cli): add /skills command and wire skill index`
12. `docs: update skill system docs`
13. `test: cover context assembly sections, Anthropic provider, and skill system`
14. `docs: complete phase 3`

## 11. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Prompt Assembly](../architecture/prompt-assembly.md)
- [Context Engine](../architecture/context-engine.md)
- [Skill System](../architecture/skill-system.md)
- [Model Provider](../architecture/model-provider.md)
- [Agent Loop](../architecture/agent-loop.md)
- [Runtime Composition](../architecture/runtime-composition.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)
- [Decision 0005: Anthropic Provider](../decisions/0005-anthropic-provider.md)

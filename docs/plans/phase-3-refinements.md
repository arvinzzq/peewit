# Phase 3 Refinements Plan

Status: Ready
Date: 2026-05-04

Simplified Chinese version: [phase-3-refinements.zh-CN.md](./phase-3-refinements.zh-CN.md)

## Purpose

This plan tracks three code changes identified during post-Phase-3 / post-Phase-4 documentation review. The changes align the implementation with confirmed OpenClaw standards and Anthropic best practices.

None of these changes add new functionality. They correct the implementation to match the architecture now documented.

## Changes

### 1. XML Section Format in Context Assembler

**Package**: `packages/context/src/index.ts`

**Problem**: The context assembler produces Markdown-header-delimited sections. Documentation (decision 0006) establishes that XML tags are the correct format.

**Required change**:
- Replace Markdown header output in each section builder with XML-tagged output.
- Example: `## Identity\n\n${content}` → `<identity>\n${content}\n</identity>`
- Sections: identity, runtime, safety, tooling, skills, workspace, session.

**Test impact**:
- All tests that assert against section text must be updated to match XML format.
- The XML tag names should match the section names exactly.

**Non-goals**: No change to section content, section order, or section inputs.

### 2. Remove `when` from `ContextSkillSummary` and `SkillDefinition`

**Packages**: `packages/context/src/index.ts`, `packages/skills/src/index.ts`

**Problem**: Both packages define a `when` field in their skill-related types. OpenClaw source research confirms the correct standard uses only `name` + `description`. The `when` intent should be part of `description`.

**Required changes**:

`packages/context/src/index.ts`:
- Remove `when?: string` from `ContextSkillSummary`.
- Update skills section builder to not include a `when` line.

`packages/skills/src/index.ts`:
- Remove `when?: string` from `SkillDefinition`.
- Remove `when?: string` from `SkillSummary`.
- Update `parseSKILLMd()` to not extract a `when` field.
- Update built-in skill definitions: merge `when` content into `description` where it exists.
- Update `toSkillSummary()` accordingly.

**Test impact**:
- Skills tests that assert on the `when` field must be updated.
- Built-in skill assertions must be updated.
- Context assembly skill section tests must be updated.

**CLI impact**:
- `apps/cli/src/index.ts`: `/skills` command renders skill summaries. Remove any reference to `when` in that rendering.

**Non-goals**: No change to skill body content, loading logic, or precedence rules.

### 3. Prompt Caching in `AnthropicProvider`

**Package**: `packages/models/src/index.ts`

**Problem**: The `AnthropicProvider` sends the system prompt as a plain string. Decision 0006 establishes that it should be sent as an array with `cache_control: { type: "ephemeral" }` so Anthropic can cache the stable system prefix.

**Required change**:
- In `AnthropicProvider.generate()`, change the `system` parameter from a string to an array containing one object: `{ type: "text", text: systemContent, cache_control: { type: "ephemeral" } }`.
- This is only needed when `systemContent` is non-empty.

**Test impact**:
- Tests that assert the exact shape of the Anthropic API call must be updated to match the array format.
- The injectable `AnthropicClientLike` interface and test stubs must handle the array form.

**Non-goals**: No change to message translation, tool call handling, or error normalization.

## Order of Changes

1. Remove `when` fields first (smallest blast radius, purely internal types).
2. Apply XML format to context assembler (affects test assertions broadly).
3. Add prompt caching (Anthropic API call shape change, isolated to one provider).

## Acceptance Criteria

- `pnpm run check` passes with zero errors and zero test failures after all three changes.
- The `/skills` CLI command does not render a `when:` line.
- The context assembler test output shows XML-tagged sections.
- The Anthropic provider sends `system` as an array with `cache_control`.

## Related Documents

- [Decision 0006 — XML Prompt Format and Caching](../decisions/0006-xml-prompt-format-and-caching.md)
- [Prompt Assembly](../architecture/prompt-assembly.md)
- [Skill System](../architecture/skill-system.md)
- [Model Provider](../architecture/model-provider.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)

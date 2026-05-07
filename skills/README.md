# Skills

Workspace-local skills. These take precedence over user-level (`~/.vole/skills/`) and built-in skills.

## How Skills Work

Each `.md` file in this directory is a skill. The agent sees a compact index of all enabled skills in its system prompt (`<skills>` section). When it needs the full content of a skill, it calls `load_skill`.

The agent decides *whether* to load a skill based solely on the `description` field. Everything else in the body is only visible after loading. **Write descriptions so the agent can make the right routing decision.**

## Skill File Format

```markdown
---
name: skill-name
description: >
  One paragraph describing what this skill provides.
  Use when: [specific trigger conditions — what tasks or situations call for this skill].
  Skip when: [situations where this skill is NOT needed or would be a wrong choice].
version: "1.0"
---

# Skill Title

## SOP: [Primary Workflow Name]

Numbered steps for the main flow. Decision points explicit. No ambiguity.

---

## Requirements

What must be true about the output or action.

## Output Format / Structure

Template or schema the output should follow.

## Examples

Concrete before/after or input/output pairs that show exactly how to apply the skill.

## Notes

Edge cases, gotchas, exceptions.
```

## Description Writing Rules

The `description` must answer three questions:

1. **What** — what capabilities or knowledge does this skill provide?
2. **Use when** — specific trigger conditions. Be concrete ("when TypeScript type errors appear") not vague ("when doing coding").
3. **Skip when** — when loading this skill would be unnecessary or wrong. Prevents over-loading.

### Good example

```
TypeScript monorepo development conventions: file editing workflow,
vitest test patterns, union type narrowing, bilingual doc rules.
Use when: writing or modifying TypeScript/test files; hitting TS type
errors; updating bilingual docs; unsure which file tool to use.
Skip when: read-only tasks (search, analysis, Q&A); tasks unrelated
to this codebase's code or docs.
```

### Bad example

```
Coding conventions for this project.
```

No trigger conditions, no exclusion conditions — the agent can't route.

## Body Writing Rules

A skill body must provide **actionable procedure**, not just facts. The difference:

| Weak (knowledge dump) | Strong (SOP + examples) |
|---|---|
| "Use edit_file for modifications" | Step-by-step flow: locate → read → edit → verify → fix |
| "TypeScript uses union types" | Numbered options with code examples, error message as trigger |
| "Tests use vitest" | Import pattern, mkdtemp pattern, what goes where, what fails |

**Every skill body should have at minimum:**
- At least one numbered SOP (main flow)
- Requirements section (what the output/action must satisfy)
- At least one concrete example (input → action → output)
- Notes section (gotchas, edge cases, common mistakes)

See `skills/generate-tool-schema.md` as the reference example of a well-structured skill.

## Skill Scope Principle

One skill = one domain or workflow. Don't bundle unrelated knowledge.

Prefer: `vole-dev`, `writing-style`, `data-analysis` — one skill per domain.
Avoid: a monolithic "everything about this project" skill.

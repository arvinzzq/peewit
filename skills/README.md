# Skills

Workspace-local skills. These take precedence over user-level (`~/.peewit/skills/`) and built-in skills.

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

[Full skill content — instructions, patterns, examples, reference material]
```

## Description Writing Rules

The `description` must answer three questions:

1. **What** — what capabilities or knowledge does this skill provide?
2. **Use when** — specific conditions that should trigger loading this skill. Be concrete ("when TypeScript type errors appear", "when writing vitest tests") not vague ("when doing coding tasks").
3. **Skip when** — situations where loading this skill would be unnecessary or wrong. This prevents the agent from over-loading skills and wasting context.

### Good description example

```
TypeScript monorepo development conventions: file editing workflow,
vitest test patterns, union type narrowing, bilingual doc rules.
Use when: writing or modifying TypeScript/test files; hitting TS type
errors; updating bilingual docs; unsure which file tool to use.
Skip when: read-only tasks (search, analysis, Q&A); tasks unrelated
to this codebase's code or docs.
```

### Bad description example

```
Coding conventions for this project.
```

Bad because: no trigger conditions, no exclusion conditions — the agent can't decide when to load it.

## Skill Scope Principle

Each skill should cover one domain or workflow. Don't bundle unrelated knowledge into one skill. A skill that's "everything about this project" is too broad — the agent will load it for everything.

Prefer: one skill per domain (`peewit-dev`, `writing-style`, `data-analysis`) rather than one monolithic skill.

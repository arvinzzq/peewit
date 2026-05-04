# Skills Agent Guide

## Responsibility

Keep skill discovery, SKILL.md parsing, precedence logic, built-in skills, and summary projection here. This package exposes SkillDefinition (full) and SkillSummary (compact) to callers. Context assembly consumes compact summaries; CLI display uses full definitions.

## When Files Change

Update README and AGENTS files when skill loading locations, built-in skills, SKILL.md format, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Discovery order, precedence rules for duplicate names, SKILL.md parsing, malformed or missing file tolerance, built-in skill presence, and summary projection all need tests.

## Boundaries

Do not call model providers, execute tools, read secrets, or decide context section inclusion here. Skill content guides behavior; it does not execute actions or grant permissions.

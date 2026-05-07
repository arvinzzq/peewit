# Skills Agent Guide

## Responsibility

Keep skill discovery, SKILL.md parsing, precedence logic, built-in skills, summary projection, and Phase 9 skill lifecycle management here. This package exposes SkillDefinition (full, with extended metadata), SkillSummary (compact), SkillManifest, SkillManifestEntry, and SkillManager to callers. Context assembly consumes compact summaries; CLI display uses full definitions; CLI commands use SkillManager for lifecycle operations.

## When Files Change

Update README and AGENTS files when skill loading locations, built-in skills, SKILL.md format, manifest format, SkillManager API, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Discovery order, precedence rules for duplicate names, SKILL.md parsing (including extended frontmatter fields), manifest-based disabled/trusted filtering, SkillManager install/enable/disable/trust/review/listEntries, malformed or missing file tolerance, built-in skill presence, and summary projection all need tests.

## Boundaries

Do not call model providers, execute tools, read secrets, or decide context section inclusion here. Skill content guides behavior; it does not execute actions or grant permissions. The trusted flag is advisory — actual tool permission decisions are made by @vole/permissions.

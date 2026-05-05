# Skills Package

## Architecture Summary

This directory owns local skill discovery, prompt integration, and the Phase 9 skill lifecycle.
It loads `SKILL.md` files from workspace, user, and built-in locations in precedence order.
User skills are tracked in `~/.arvinclaw/skills/skills-index.json` (the manifest), which records install time, trust, and enabled state.
It exposes a compact `SkillSummary` for context injection and a full `SkillDefinition` for CLI display.
`SkillManager` provides install, enable, disable, trust, review, and listEntries operations against the manifest.
Built-in skills (research, project-inspector, safe-shell) are always trusted and available by default.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the skills package and exports. |
| `tsconfig.json` | TypeScript config | Builds the skills package. |
| `src/index.ts` | Skill system | Exports SkillDefinition (with version, origin, permissions, trusted, enabled, filePath), SkillSummary, SkillManifest, SkillManifestEntry, SkillLoader with precedence loading and manifest-aware user skill filtering, SkillManager for install/enable/disable/trust lifecycle, parseSKILLMd (comma-separated and YAML array permissions), and toSkillSummary. |
| `src/index.test.ts` | Skill tests | Protects SKILL.md parsing including extended frontmatter fields, workspace/user/built-in loading, precedence rules, manifest-based disabled/trusted filtering, SkillManager install/enable/disable/trust/review/listEntries, error tolerance for missing or invalid files, and summary projection. |

## Update Reminder

Update this file when the directory structure changes.

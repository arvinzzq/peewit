# Skills Package

## Architecture Summary

This directory owns local skill discovery and prompt integration.
It loads `SKILL.md` files from workspace, user, and built-in locations in precedence order.
It exposes a compact `SkillSummary` for context injection and a full `SkillDefinition` for CLI display.
Built-in skills (research, project-inspector, safe-shell) are available by default.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the skills package and exports. |
| `tsconfig.json` | TypeScript config | Builds the skills package. |
| `src/index.ts` | Skill system | Exports SkillDefinition, SkillSummary, SkillLoader with precedence loading and injectable file system ops, parseSKILLMd, toSkillSummary, and built-in skills. |
| `src/index.test.ts` | Skill tests | Protects SKILL.md parsing, workspace/user/built-in loading, precedence rules, error tolerance for missing or invalid files, and summary projection. |

## Update Reminder

Update this file when the directory structure changes.

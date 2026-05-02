# Skills Package

## Architecture Summary

This directory reserves the local skill discovery boundary.
It will read and summarize `SKILL.md` files for prompt integration.
It keeps skill loading separate from prompt assembly and runtime orchestration.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the skills package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the skills package. |
| `src/index.ts` | Package boundary | Exports the current package marker and future skill API surface. |

## Update Reminder

Update this file when the directory structure changes.

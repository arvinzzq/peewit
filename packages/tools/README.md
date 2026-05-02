# Tools Package

## Architecture Summary

This directory reserves the tool registry and execution boundary.
It will validate inputs and wrap built-in tools such as file, shell, and web capabilities.
It must not decide permissions; permission policy lives in `packages/permissions`.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the tools package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the tools package. |
| `src/index.ts` | Package boundary | Exports the current package marker and future tool API surface. |

## Update Reminder

Update this file when the directory structure changes.

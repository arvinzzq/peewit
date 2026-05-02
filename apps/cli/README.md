# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It must not own agent planning, prompt assembly, model calls, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with project references. |
| `src/index.ts` | CLI adapter | Parses commands and renders CLI results. |
| `src/index.test.ts` | CLI tests | Protects help, version, chat placeholder, and unknown-command behavior. |

## Update Reminder

Update this file when the directory structure changes.

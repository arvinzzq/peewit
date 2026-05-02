# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It wires CLI-visible commands to runtime dependencies without owning agent planning, prompt assembly, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, build scripts, and runtime package dependencies. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with references to core, context, and models. |
| `src/index.ts` | CLI adapter | Parses commands, runs the fake-provider chat smoke path, and renders assistant output plus compact trace lines. |
| `src/index.test.ts` | CLI tests | Protects help, version, chat placeholder, fake-provider chat, compact trace rendering, and unknown-command behavior. |

## Update Reminder

Update this file when the directory structure changes.

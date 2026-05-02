# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It wires CLI-visible commands to runtime and config dependencies without owning agent planning, prompt assembly, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, build scripts, and runtime/config package dependencies. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with references to config, core, context, and models. |
| `src/index.ts` | CLI adapter | Parses commands, runs the interactive fake-provider chat loop, stores in-process trace events, and renders `/help`, `/trace`, `/config`, and `/exit`. |
| `src/index.test.ts` | CLI tests | Protects help, version, interactive chat, fake-provider chat, compact trace rendering, `/trace`, `/config`, and unknown-command behavior. |

## Update Reminder

Update this file when the directory structure changes.

# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It wires CLI-visible commands to runtime, config, and durable session/message/trace dependencies without owning agent planning, prompt assembly, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, build scripts, and runtime/config/session package dependencies. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with references to config, core, context, and models. |
| `src/index.ts` | CLI adapter | Parses commands, lists stored sessions, runs configured and fake interactive chat loops, persists JSONL messages/traces, and renders `/help`, `/trace`, `/config`, and `/exit`. |
| `src/index.test.ts` | CLI tests | Protects help, version, session listing, configured chat, durable message/trace handoff, short-term memory handoff, fake-provider chat, compact trace rendering, `/trace`, `/config`, missing API key handling, and unknown-command behavior. |

## Update Reminder

Update this file when the directory structure changes.

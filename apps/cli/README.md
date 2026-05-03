# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It wires CLI-visible commands and approval prompts to runtime, returns approval decisions through the runtime resolver, configures workspace prompt and read-only long-term/daily memory loading, and manages durable session/message/trace dependencies without owning agent planning, prompt assembly, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, build scripts, and runtime/config/session package dependencies. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with references to config, core, context, and models. |
| `src/index.ts` | CLI adapter | Parses commands, lists and resumes stored sessions, wires workspace prompt files plus read-only long-term/daily memory files into context assembly, runs configured and fake interactive chat loops, resolves ask-level tool approvals for runtime, persists JSONL messages/traces, and renders `/help`, `/trace`, `/config` including memory policy, permission trace labels, and `/exit`. |
| `src/index.test.ts` | CLI tests | Protects help, version, session listing/resume, workspace prompt and long-term/daily memory handoff, configured chat, durable message/trace handoff, short-term memory handoff, fake-provider chat, ask-level approval prompts, compact tool and permission trace rendering, `/trace`, `/config` memory policy output, missing API key handling, and unknown-command behavior. |

## Update Reminder

Update this file when the directory structure changes.

# CLI App

## Architecture Summary

This directory owns the command-line entry point.
It translates terminal input and output around shared runtime packages.
It wires CLI-visible commands, built-in file tools, and approval prompts to runtime, returns approval decisions through the runtime resolver, configures workspace prompt and read-only long-term/daily memory loading, and manages durable session/message/trace dependencies without owning agent planning, prompt assembly, tools, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the CLI package, executable name, build scripts, and runtime/config/session/skill/tool/scheduler/gateway/adapters/taskflow package dependencies. |
| `tsconfig.json` | TypeScript config | Builds the CLI package with references to adapters, config, core, context, gateway, models, scheduler, skills, taskflow, and tools. |
| `src/index.ts` | CLI adapter | Parses commands, lists and resumes stored sessions, loads skills, wires workspace prompt/memory files including TOOLS.md, IDENTITY.md, HEARTBEAT.md, and BOOTSTRAP.md, registers built-in tools including `spawn_subagent`, runs configured/fake interactive loops, resolves approvals, persists JSONL sessions/traces, displays todos progress, runs one-shot background tasks (`run` command), runs memory dreaming (`run --dream` — requires VOLE_LONG_TERM_MEMORY=write), lists task run history (`tasks` command), provides skills subcommands (`skills install/enable/disable/trust/review`) backed by SkillManager, runs the task scheduler daemon (`daemon` and `daemon --once` commands) that loads `*.task.json` files from the tasks directory and executes cron-scheduled tasks via `CronScheduler`, provides taskflow subcommands (`taskflow list`, `taskflow list --limit N`, `taskflow show <id>`, `taskflow cancel <id>`) backed by `JsonlTaskFlowStore`, registers CLI sessions in module-level `SessionGateway` singleton, unregisters on `close()`, and exports `CliChatSession` with `sendMessage(opts.onEvent)` and `CreateChatSessionOptions` (approvalResolver, preferStreaming). Real interactive chat routes to `src/app.tsx` via dynamic import. |
| `src/app.tsx` | Ink chat app | Full Ink-based chat UI: `ChatApp` component with streaming text (`token_delta`), tool progress spinner, approval prompts, todos panel, and text input via `useInput`. `runInkChat()` entry point used by `main()`. Session created inside component with injectable Ink approval resolver. |
| `src/index.test.ts` | CLI tests | Protects help, version, session listing/resume, workspace prompt and long-term/daily memory handoff, TOOLS.md and additional workspace file loading, graceful skip of missing workspace files, configured chat, durable message/trace handoff, short-term memory handoff, fake-provider chat, built-in file and web tool execution, ask-level approval prompts, compact tool lifecycle and permission trace rendering, `/trace`, `/config` memory policy output, missing API key handling, unknown-command behavior, skills install/disable/trust/review subcommands, daemon missing-API-key, missing tasks directory, cron task execution, non-cron task skipping, taskflow list empty, taskflow show not-found, and `run --dream` write-policy enforcement. |

## Update Reminder

Update this file when the directory structure changes.

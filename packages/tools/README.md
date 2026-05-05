# Tools Package

## Architecture Summary

This directory owns the tool registry and execution boundary.
It defines tool metadata, validates inputs, normalizes results, and wraps built-in tools such as file, shell, and web capabilities.
It must not decide permissions; permission policy lives in `packages/permissions`.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the tools package, export entrypoint, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the tools package. |
| `src/index.ts` | Tool registry and built-in tools | Exports tool definition contracts, executable tool contracts, risk metadata, registry lookup/listing behavior, read-only file tools, guarded write_file tool, guarded shell tool, read_web_page tool, `update_todos` task tracker tool, `load_skill` on-demand skill loader, `createLoadSkillTool` factory, `SkillFileMap` type, `LoadSkillResult` type, `TodoItem` type, `SpawnSubagentResult` type for sub-agent tool results, normalized tool results, and registry errors. |
| `src/index.test.ts` | Tool tests | Protects registry lookup, deterministic listing, defensive copies, duplicate registration errors, read-only and write_file tools, shell tool execution, web page fetching and HTML extraction, workspace boundaries, secret file blocking, blocked command patterns, timeout handling, HTTP and network errors, normalized failures, `update_todos` validation and callback behavior, and `load_skill` file map resolution, unknown skill errors, and unreadable file errors. |

## Update Reminder

Update this file when the directory structure changes.

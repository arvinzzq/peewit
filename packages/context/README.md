# Context Package

## Architecture Summary

This directory owns provider-neutral context assembly.
It decides what model messages are built from system instructions, runtime metadata, workspace prompt files, recent conversation history, and user input.
It prepares the future path for memory, skills, tools, redaction, and compaction.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares context package exports and dependency on models. |
| `tsconfig.json` | TypeScript config | Builds context with a reference to models. |
| `src/index.ts` | Context assembler | Exports context assembly contracts and default assembler with optional workspace prompt file loading. |
| `src/index.test.ts` | Context tests | Protects deterministic message ordering, workspace prompt loading, short-term conversation history, and assembly reports. |

## Update Reminder

Update this file when the directory structure changes.

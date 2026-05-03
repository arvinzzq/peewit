# Context Package

## Architecture Summary

This directory owns provider-neutral context assembly.
It decides what model messages are built from system instructions, runtime metadata, recent conversation history, and user input.
It prepares the future path for workspace files, memory, skills, tools, and compaction.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares context package exports and dependency on models. |
| `tsconfig.json` | TypeScript config | Builds context with a reference to models. |
| `src/index.ts` | Context assembler | Exports context assembly contracts and default assembler. |
| `src/index.test.ts` | Context tests | Protects deterministic message ordering, short-term conversation history, and assembly reports. |

## Update Reminder

Update this file when the directory structure changes.

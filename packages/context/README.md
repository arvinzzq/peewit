# Context Package

## Architecture Summary

This directory owns provider-neutral context assembly.
It assembles model input from named sections in a deterministic order: identity, runtime, tooling, safety, skills, workspace, conversation_history, and user_message.
It accepts tool summaries, skill index, and permission guidance from callers without importing those packages.
It produces a per-section assembly report so callers can inspect what was included or omitted and why.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares context package exports and dependency on models. |
| `tsconfig.json` | TypeScript config | Builds context with a reference to models. |
| `src/index.ts` | Context assembler | Exports context assembly contracts, section-based assembler with named sections, tool summary and skill index inputs, permission guidance, optional workspace prompt file loading, `PromptMode` type for full/minimal/none assembly control, `compactMessages` for context overflow prevention, `CompactionOptions`, and `DEFAULT_COMPACTION_OPTIONS`. |
| `src/index.test.ts` | Context tests | Protects section ordering, section inclusion and omission, tooling section format, safety section format, skills section format, workspace prompt loading, short-term conversation history, assembly reports, prompt mode behavior (full/minimal/none), and `compactMessages` compaction behavior. |

## Update Reminder

Update this file when the directory structure changes.

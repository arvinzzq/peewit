# Adapters Package

## Architecture Summary

This directory owns the adapter capability interface for ArvinClaw.
It declares what interaction modes each surface adapter supports: streaming output, interactive approval prompts, and background execution.
It provides canonical capability constants for CLI, Web, and background adapters.
It also provides tool profile definitions so adapters can restrict which tools are available for a given session or task type.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the adapters package, public exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the adapters package. |
| `src/index.ts` | Capability interface and tool profiles | Exports `AdapterCapabilities` interface, `AdapterStorageType` type, `CLI_CAPABILITIES`, `WEB_CAPABILITIES`, `BACKGROUND_CAPABILITIES` constants, `ToolProfile` type, `ToolProfileDefinition` interface, `TOOL_PROFILES` record, and `filterToolsByProfile` function. |
| `src/index.test.ts` | Capability and profile tests | Protects capability constant values, interface compliance, the rule that background adapters cannot have interactive approval prompts, tool profile definitions for all four profiles, and `filterToolsByProfile` filtering behavior. |

## Update Reminder

Update this file when the directory structure changes.

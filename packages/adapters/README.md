# Adapters Package

## Architecture Summary

This directory owns the adapter capability interface for ArvinClaw.
It declares what interaction modes each surface adapter supports: streaming output, interactive approval prompts, and background execution.
It provides canonical capability constants for CLI, Web, and background adapters.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the adapters package, public exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the adapters package. |
| `src/index.ts` | Capability interface | Exports `AdapterCapabilities` interface, `AdapterStorageType` type, and `CLI_CAPABILITIES`, `WEB_CAPABILITIES`, `BACKGROUND_CAPABILITIES` constants. |
| `src/index.test.ts` | Capability tests | Protects capability constant values, interface compliance, and the rule that background adapters cannot have interactive approval prompts. |

## Update Reminder

Update this file when the directory structure changes.

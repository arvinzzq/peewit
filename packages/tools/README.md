# Tools Package

## Architecture Summary

This directory owns the tool registry and execution boundary.
It defines tool metadata and will validate inputs and wrap built-in tools such as file, shell, and web capabilities.
It must not decide permissions; permission policy lives in `packages/permissions`.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the tools package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the tools package. |
| `src/index.ts` | Tool registry | Exports tool definition contracts, risk metadata, registry lookup/listing behavior, and registry errors. |
| `src/index.test.ts` | Tool tests | Protects registry lookup, deterministic listing, defensive copies, and duplicate registration errors. |

## Update Reminder

Update this file when the directory structure changes.

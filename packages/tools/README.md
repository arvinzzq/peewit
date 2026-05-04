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
| `src/index.ts` | Tool registry and file tools | Exports tool definition contracts, executable tool contracts, risk metadata, registry lookup/listing behavior, read-only file tools, guarded write_file tool, normalized tool results, and registry errors. |
| `src/index.test.ts` | Tool tests | Protects registry lookup, deterministic listing, defensive copies, duplicate registration errors, read-only and write_file tools, workspace boundaries, secret file blocking, and normalized failures. |

## Update Reminder

Update this file when the directory structure changes.

# Config Package

## Architecture Summary

This directory owns configuration loading and validation.
It merges defaults, user config, project config, and environment overrides.
It keeps secrets redacted before configuration is shown in traces or CLI output.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the config package, public exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the config package. |
| `src/index.ts` | Config loader | Exports config types, defaults, merge logic, validation, and redaction. |
| `src/index.test.ts` | Config tests | Protects defaults, precedence, env overrides, redaction, and validation errors. |

## Update Reminder

Update this file when the directory structure changes.

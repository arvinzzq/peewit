# Permissions Package

## Architecture Summary

This directory reserves the permission policy boundary.
It will classify tool and runtime actions by risk.
It will decide allow, ask, deny, or block without owning the user interface.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the permissions package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the permissions package. |
| `src/index.ts` | Package boundary | Exports the current package marker and future permission API surface. |

## Update Reminder

Update this file when the directory structure changes.

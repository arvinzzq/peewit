# Permissions Package

## Architecture Summary

This directory owns the permission policy boundary.
It classifies tool actions by risk and autonomy mode.
It decides allow, ask, or deny without owning the user interface.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the permissions package and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the permissions package. |
| `src/index.ts` | Permission policy | Exports autonomy/risk/decision contracts and the default permission policy. |
| `src/index.test.ts` | Permission tests | Protects observe, confirm, auto, and blocked-action decision behavior. |

## Update Reminder

Update this file when the directory structure changes.

# Models Package

## Architecture Summary

This directory owns provider-neutral model contracts.
It normalizes vendor behavior behind `ModelProvider`.
It lets Agent Core call models without depending on vendor SDK details.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares public package exports and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the models package. |
| `src/index.ts` | Provider layer | Exports model types, fake provider, and OpenAI-compatible provider. |
| `src/index.test.ts` | Provider tests | Protects fake provider behavior and OpenAI-compatible normalization. |

## Update Reminder

Update this file when the directory structure changes.

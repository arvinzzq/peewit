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
| `src/index.ts` | Provider layer | Exports model message types, ModelToolDefinition, ModelInput with tools, ModelOutput union, fake provider, and OpenAI-compatible provider with tool schema sending and tool_calls response parsing. |
| `src/index.test.ts` | Provider tests | Protects fake provider behavior, OpenAI-compatible normalization, tool definition request body, tool_calls response parsing, and tool/assistant message formatting. |

## Update Reminder

Update this file when the directory structure changes.

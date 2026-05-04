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
| `src/index.ts` | Provider layer | Exports model message types, ModelToolDefinition, ModelInput with tools, ModelOutput union, fake provider, OpenAI-compatible provider with tool schema sending and tool_calls response parsing, and Anthropic provider with message format translation and tool_use/tool_result block handling. |
| `src/index.test.ts` | Provider tests | Protects fake provider behavior, OpenAI-compatible normalization, tool definition request body, tool_calls response parsing, tool/assistant message formatting, and Anthropic provider message translation, tool definition translation, tool_use response parsing, and error normalization. |

## Update Reminder

Update this file when the directory structure changes.

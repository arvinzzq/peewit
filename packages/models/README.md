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
| `src/index.ts` | Provider layer | Exports model message types, ModelToolDefinition, ModelInput, ModelOutput union, StreamEvent union, StreamingModelProvider interface, isStreamingProvider type guard, FakeModelProvider, FakeStreamingProvider, OpenAI-compatible provider (generate + generateStream with SSE parsing), Anthropic provider (generate + generateStream with injectable streamClient), and ThinkingBudget type (maps off/minimal/low/medium/high/max/adaptive to Anthropic extended thinking API params). |
| `src/index.test.ts` | Provider tests | Protects fake provider behavior, isStreamingProvider detection, FakeStreamingProvider streaming, OpenAI SSE streaming (text and tool_calls), Anthropic streaming (text, tool_calls, and non-streaming fallback), Anthropic thinking budget (medium passes budget_tokens, off omits thinking param, adaptive passes type=adaptive), plus all existing generate() tests. |

## Update Reminder

Update this file when the directory structure changes.

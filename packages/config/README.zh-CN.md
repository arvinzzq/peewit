# Config Package

## Architecture Summary

这个目录拥有 configuration loading 和 validation。
它合并 defaults、user config、project config、workspace/model/memory environment overrides 和 provider-specific shortcuts。
它在 configuration 显示到 traces 或 CLI output 前保持 secrets redacted。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 config package、public exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 config package。 |
| `src/index.ts` | Config loader | 导出 config types、defaults、merge logic、workspace/model/memory env handling、OpenRouter 和 Anthropic API key shortcuts、provider 选择（openai-compatible 或 anthropic）、`PromptMode` 类型、`ARVINCLAW_PROMPT_MODE` env var、`ExecutionContract` 类型、`ARVINCLAW_EXECUTION_CONTRACT` env var、`ToolProfileConfig` 类型、`ARVINCLAW_TOOL_PROFILE` env var、`ARVINCLAW_SANDBOX` env var（布尔值，启用 shell tool sandbox 模式）、`ThinkingBudget` 类型、`ARVINCLAW_THINKING_BUDGET` env var（off/minimal/low/medium/high/max/adaptive）、validation、redaction 和 `resolveSessionsDirectory` helper。 |
| `src/index.test.ts` | Config tests | 保护 defaults、precedence、workspace/model/memory env overrides、OpenRouter shortcut handling、ANTHROPIC_API_KEY shortcut handling、redaction、validation errors、`ARVINCLAW_PROMPT_MODE` env var 处理、`ARVINCLAW_EXECUTION_CONTRACT` env var 处理、无效 execution contract 验证、`ARVINCLAW_TOOL_PROFILE` env var 处理、无效 tool profile 验证、`ARVINCLAW_SANDBOX` env var 处理、`ARVINCLAW_THINKING_BUDGET` env var 处理、无效 thinking budget 验证和 `resolveSessionsDirectory` 行为。 |

## Update Reminder

目录结构变化时更新此文件。

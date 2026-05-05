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
| `src/index.ts` | Config loader | 导出 config types、defaults、merge logic、workspace/model/memory env handling、OpenRouter 和 Anthropic API key shortcuts、provider 选择（openai-compatible 或 anthropic）、validation、redaction 和 `resolveSessionsDirectory` helper。 |
| `src/index.test.ts` | Config tests | 保护 defaults、precedence、workspace/model/memory env overrides、OpenRouter shortcut handling、ANTHROPIC_API_KEY shortcut handling、redaction、validation errors 和 `resolveSessionsDirectory` 行为。 |

## Update Reminder

目录结构变化时更新此文件。

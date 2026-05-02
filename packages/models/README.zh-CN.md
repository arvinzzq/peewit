# Models Package

## Architecture Summary

这个目录拥有 provider-neutral model contracts。
它在 `ModelProvider` 后面归一化 vendor behavior。
它让 Agent Core 可以调用 models，而不依赖 vendor SDK details。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 public package exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 models package。 |
| `src/index.ts` | Provider layer | 导出 model types、fake provider 和 OpenAI-compatible provider。 |
| `src/index.test.ts` | Provider tests | 保护 fake provider behavior 和 OpenAI-compatible normalization。 |

## Update Reminder

目录结构变化时更新此文件。

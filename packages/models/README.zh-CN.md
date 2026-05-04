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
| `src/index.ts` | Provider layer | 导出 model message types、ModelToolDefinition、含 tools 的 ModelInput、ModelOutput union、fake provider，以及支持 tool schema 发送和 tool_calls 响应解析的 OpenAI-compatible provider。 |
| `src/index.test.ts` | Provider tests | 保护 fake provider behavior、OpenAI-compatible normalization、tool definition request body、tool_calls 响应解析以及 tool/assistant 消息格式化。 |

## Update Reminder

目录结构变化时更新此文件。

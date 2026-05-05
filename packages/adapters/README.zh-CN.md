# Adapters Package

## 架构摘要

这个目录拥有 ArvinClaw 的 adapter capability interface。
它声明每个界面 adapter 支持哪些交互模式：streaming 输出、交互式 approval prompts 和后台执行。
它为 CLI、Web 和 background adapters 提供规范 capability 常量。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 adapters package、public exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 adapters package。 |
| `src/index.ts` | Capability interface | 导出 `AdapterCapabilities` interface、`AdapterStorageType` type 和 `CLI_CAPABILITIES`、`WEB_CAPABILITIES`、`BACKGROUND_CAPABILITIES` 常量。 |
| `src/index.test.ts` | Capability tests | 保护 capability 常量值、interface 合规性，以及 background adapters 不能有交互式 approval prompts 的规则。 |

## Update Reminder

目录结构变化时更新此文件。

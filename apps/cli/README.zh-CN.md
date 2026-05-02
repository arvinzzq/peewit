# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它不能拥有 Agent planning、prompt assembly、model calls、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 使用 project references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令并渲染 CLI results。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、chat placeholder 和 unknown-command behavior。 |

## Update Reminder

目录结构变化时更新此文件。

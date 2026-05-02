# Core Package

## Architecture Summary

这个目录拥有 Agent runtime orchestration layer。
它协调 context assembly、model provider calls、structured runtime events 和 trace storage contracts。
它必须保持 adapter-agnostic 和 vendor-agnostic。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 core package 和 workspace dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 context 和 models 的 references 构建 core。 |
| `src/index.ts` | Runtime core | 导出 runtime event contracts、in-memory trace store 和 message-only `AgentRuntime`。 |
| `src/index.test.ts` | Runtime tests | 保护 event vocabulary、terminal-event detection、trace storage 和 message-only run flow。 |

## Update Reminder

目录结构变化时更新此文件。

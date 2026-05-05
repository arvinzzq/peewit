# Core Package

## Architecture Summary

这个目录拥有 Agent runtime orchestration layer。
它协调 context assembly、short-term conversation context、model provider calls、model-requested tool-call events、permission evaluation events、approval resolution events、executable tool calls、structured runtime events 和 trace storage contracts。
它必须保持 adapter-agnostic 和 vendor-agnostic。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 core package 以及 context、models、permissions 和 tools 等 workspace dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 context、models、permissions 和 tools 的 references 构建 core。 |
| `src/index.ts` | Runtime core | 导出含 `token_delta`、`todos_updated` 和 `planning_stall_detected` 的 runtime event contracts、in-memory trace store、支持可选流式路径（`preferStreaming`）的 agent loop、内置 `update_todos` 注入、规划停滞检测与重试注入、tool summary projection、default permission guidance、tool-call request events、permission evaluation events、approval resolver contracts、tool lifecycle events、`SubagentFactory` interface 和 `createSpawnSubagentTool`。 |
| `src/index.test.ts` | Runtime tests | 保护 event vocabulary（含 `token_delta`）、terminal-event detection、trace storage、context flow、message run flow、tool-call behavior、permission policy、approval resolver、tool execution、multi-round loop、step limit、规划停滞检测、`todos_updated` event emission、流式路径（`preferStreaming` 时发出 token_delta、默认时不发出），以及 `createSpawnSubagentTool` 的成功和失败路径。 |

## Update Reminder

目录结构变化时更新此文件。

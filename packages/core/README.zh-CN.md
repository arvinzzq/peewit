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
| `src/index.ts` | Runtime core | 导出含 `todos_updated` 和 `planning_stall_detected` 的 runtime event contracts、in-memory trace store、内置 `update_todos` 注入的 agent loop、规划停滞检测与重试注入、tool summary projection、default permission guidance、tool-call request events、permission evaluation events、approval resolver contracts 和 tool lifecycle events。 |
| `src/index.test.ts` | Runtime tests | 保护 event vocabulary、terminal-event detection、trace storage、context flow、message run flow、tool-call behavior、permission policy、approval resolver、tool execution、multi-round loop、step limit、规划停滞检测（承诺短语、标题、项目符号、tool-call 绕过、无 tool 绕过）和 `todos_updated` event emission。 |

## Update Reminder

目录结构变化时更新此文件。

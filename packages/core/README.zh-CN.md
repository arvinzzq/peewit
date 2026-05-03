# Core Package

## Architecture Summary

这个目录拥有 Agent runtime orchestration layer。
它协调 context assembly、short-term conversation context、model provider calls、model-requested tool-call events、permission evaluation events、structured runtime events 和 trace storage contracts。
它必须保持 adapter-agnostic 和 vendor-agnostic。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 core package 以及 context、models 和 permissions 等 workspace dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 context、models 和 permissions 的 references 构建 core。 |
| `src/index.ts` | Runtime core | 导出 runtime event contracts、in-memory trace store、message run flow、tool-call request events 和 permission evaluation events。 |
| `src/index.test.ts` | Runtime tests | 保护 event vocabulary、terminal-event detection、trace storage、recent-message context flow、message run flow、tool-call request behavior 和 runtime permission policy injection。 |

## Update Reminder

目录结构变化时更新此文件。

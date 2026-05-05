# TaskFlow Package

## Architecture Summary

这个目录负责 persistent cross-session task graph boundary。
它跨 sessions 存储 task records、追踪 task lifecycle state，并支持 sub-task 层次结构的 parent/child 关系。
它让 task graph persistence 与 runtime orchestration、session storage 和 CLI rendering 分离。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 taskflow package、package exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 使用对 sessions 的 reference 构建 taskflow package。 |
| `src/index.ts` | Task flow store | 导出 `TaskRecord`、`TaskStatus`、`TaskRuntime`、`TaskFlowStore` interface，以及带 create、update、get 和 list 操作的 `JsonlTaskFlowStore`。 |
| `src/index.test.ts` | TaskFlow tests | 保护带 timestamps 的 task record 创建、status 更新、缺失 id 时返回 undefined、按 id 获取、列出所有 records、按 status 过滤、按 parentId 过滤和 limit。 |

## Update Reminder

目录结构变化时更新此文件。

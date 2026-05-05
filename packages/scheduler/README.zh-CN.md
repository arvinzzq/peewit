# Scheduler Package

## 架构摘要

本目录拥有后台任务执行边界。
它将 task run 记录存储在 JSONL 中，为无人值守执行实现安全审批策略，并为后台和计划任务提供 task definition 类型。
它将后台任务持久化和审批策略与 runtime 编排和 UI 渲染分离。

## 文件清单

| 文件 | 角色 | 用途 |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 scheduler package、package exports、构建脚本及对 core 和 sessions 的 workspace 依赖。 |
| `tsconfig.json` | TypeScript 配置 | 构建 scheduler package，引用 core 和 sessions。 |
| `src/index.ts` | Scheduler | 导出 `TaskDefinition`、`TaskRunRecord`、`TaskStore`、`JsonlTaskStore` 和 `BackgroundApprovalResolver`。Task run 记录持久化到 JSONL 文件。Approval resolver 在 confirm/observe 模式下自动拒绝，在 auto 模式下自动批准。 |
| `src/index.test.ts` | Scheduler 测试 | 保护 task run 保存、列出、更新、taskName 过滤、limit 查询、父目录创建和 BackgroundApprovalResolver 模式行为。 |

## 更新提醒

当目录结构变化时更新本文件。

# Scheduler Package

## 架构摘要

本目录拥有后台任务执行边界。
它将 task run 记录存储在 JSONL 中，为无人值守执行实现安全审批策略，为后台和计划任务提供 task definition 类型，并通过 `CronScheduler` 运行按 cron 调度的任务。
它将后台任务持久化、审批策略和 cron 调度与 runtime 编排和 UI 渲染分离。

## 文件清单

| 文件 | 角色 | 用途 |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 scheduler package、package exports、构建脚本及对 core 和 sessions 的 workspace 依赖。 |
| `tsconfig.json` | TypeScript 配置 | 构建 scheduler package，引用 core 和 sessions。 |
| `src/index.ts` | Scheduler | 导出 `TaskDefinition`（含可选 `cron` 字段）、`TaskRunRecord`、`TaskStore`、`JsonlTaskStore`、`BackgroundApprovalResolver`、`matchesCron`、`CronScheduler`、`CronSchedulerOptions` 和 `TaskRunner`。Task run 记录持久化到 JSONL 文件。Approval resolver 在 confirm/observe 模式下自动拒绝，在 auto 模式下自动批准。`CronScheduler` 以可配置间隔轮询，运行 cron 表达式与当前时间匹配的任务，并防止同一分钟内重复运行。 |
| `src/index.test.ts` | Scheduler 测试 | 保护 task run 保存、列出、更新、taskName 过滤、limit 查询、父目录创建、BackgroundApprovalResolver 模式行为、matchesCron 通配符和精确匹配，以及 CronScheduler 的 start/stop 生命周期、每分钟去重和不匹配 cron 跳过。 |

## 更新提醒

当目录结构变化时更新本文件。

# Scheduler Agent 指南

## 职责

将后台任务运行持久化、task definition 类型和后台审批策略保留在此处。Runtime 代码应依赖 `TaskStore` 和 `ApprovalResolver` 接口，而非了解存储或策略详情。

## 文件变更时

当后台任务职责或文件清单变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或系统位置变化时，更新 `src/index.ts` header。

## 测试

Scheduler 逻辑需要对 task run 保存、列出、过滤、更新、父目录创建和 BackgroundApprovalResolver 模式行为（自动批准 vs 自动拒绝）进行测试。

## 边界

不要在此 package 中组装 prompts、调用 model providers、执行工具、应用 permission policy 或渲染 CLI 输出。不要从 `apps/cli` 或任何 adapter package 导入。

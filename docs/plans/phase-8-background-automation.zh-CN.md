# Phase 8 后台自动化计划

状态：进行中
日期：2026-05-05

English version: [phase-8-background-automation.md](./phase-8-background-automation.md)

## 进度

状态：完成

已完成提交：

- [x] Part A: 设计文档 — 后台自动化和 task queue: `e9fbe10`
- [x] Part B: `packages/scheduler` — task store、task definition types 和 BackgroundApprovalResolver: `8f70213`
- [x] Part C: `apps/cli` — 后台任务执行的 `run` 和 `tasks` 命令: `4bbc661`
- [x] Part D: 标记 Phase 8 完成

## 1. 目的

Phase 8 为 Peewit 添加后台任务执行能力。

Phase 1–7 证明了 agent 可以在终端或浏览器 session 中交互式运行。Phase 8 将 agent 扩展为可以在无前台用户连接的情况下运行任务。

最小实现：

- 一个执行任务目标的一次性后台 `run` 命令。
- 一个在无用户在场时强制安全执行策略的 `BackgroundApprovalResolver`。
- 一个持久化任务运行历史供检查的 `JsonlTaskStore`。
- 一个列出已完成、失败和运行中任务的 `tasks` 命令。

## 2. 范围

本 phase 包含：

- `packages/scheduler`：新 package，导出 `TaskDefinition`、`TaskRunRecord`、`TaskStore`、`JsonlTaskStore` 和 `BackgroundApprovalResolver`。
- `apps/cli`：用于一次性后台任务执行的 `run "<goal>"` 命令和列出任务运行历史的 `tasks` 命令。
- 后台自动化和 task queue 架构的设计文档。
- 所有新内容的双语文档。

本 phase 不包含：

- Daemon 进程管理。
- Cron 调度。
- 事件触发接口。
- 多步骤任务编排。
- 任务取消。
- 远程任务派发。
- Plugin 定义的任务类型。
- 企业级工作流引擎。

## 3. 架构摘要

### 后台 Adapter 概念

后台 adapter 在无活跃用户连接的情况下运行 agent 任务。它无法显示 streaming 输出或交互式审批提示。其 `AdapterCapabilities` 为 `BACKGROUND_CAPABILITIES = { streaming: false, approvalPrompts: false, background: true }`。

由于无用户在场，后台 adapter 用 `BackgroundApprovalResolver` 替换交互式 `ApprovalResolver`，强制执行安全默认策略。

### BackgroundApprovalResolver

`BackgroundApprovalResolver` 控制在无人值守执行期间工具需要用户确认时的行为。

```
mode = "auto"     → 自动批准 ask 级决策
mode = "confirm"  → 自动拒绝（无用户在场）
mode = "observe"  → 自动拒绝（无用户在场）
```

在 `auto` 模式下，resolver 信任模型只请求适当的工具。在 `confirm` 和 `observe` 模式下，由于没有用户可以咨询，resolver 拒绝任何需要交互审批的工具。

此 resolver 与 `@peewit/core` 中现有的 `ApprovalResolver` 接口集成。无需更改 `AgentRuntime`。

### Task Definition 格式

任务定义为结构化配置对象：

```ts
interface TaskDefinition {
  name: string;
  goal: string;
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

Phase 8 中，task definitions 直接作为参数传递给 `run` 命令。基于文件的 task definitions 是未来扩展。

### Task Run 生命周期

```
run 命令调用
  → 创建 task run 记录（status: running）
  → 创建带 BackgroundApprovalResolver 的 AgentRuntime
  → 调用 runTurn({ message: goal })
  → 收集 events
  → 打印紧凑 trace
  → 更新 task run 记录（status: completed | failed）
  → 成功退出 0，失败退出 1
```

每次运行产出：

- sessions 目录中的一个 session 文件（标准 JSONL session 格式）。
- `task-runs.jsonl` 中的一条 task run 记录（任务特定元数据和状态）。

### Daemon 方向

完整 daemon 模式（Phase 8+）将管理一个从队列中拾取计划任务的后台进程。Phase 8 实现了 daemons 内部将使用的一次性执行路径。未来的 daemon 包装器可以按计划调用相同的 `runBackgroundTask` 逻辑。

## 4. 提交序列

1. **docs**：设计文档（本文件 + zh-CN + 架构文档）— docs:check 必须通过。
2. **feat(scheduler)**：`packages/scheduler` — `JsonlTaskStore` + `BackgroundApprovalResolver` + 测试。
3. **feat(cli)**：`apps/cli` — `run` 和 `tasks` 命令。
4. **docs**：标记 Phase 8 完成。

## 5. 验收标准

- `peewit run "<goal>"` 执行任务并打印紧凑 trace。
- `peewit run "<goal>" --mode auto` 使用自动审批策略。
- `peewit tasks` 列出带状态的最近任务运行。
- 后台任务将运行记录持久化到 `task-runs.jsonl`。
- 危险动作在后台模式下遵守 permission policy。
- 失败的后台任务在 `peewit tasks` 输出中可见。

## 6. 非目标

- 不做 daemon 进程。
- 不做 cron 调度。
- 不做事件触发接口。
- 不做完全自主且不受限制的执行。
- 不做企业级工作流引擎。
- 不做 multi-agent 协调。

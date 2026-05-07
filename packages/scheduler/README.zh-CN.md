# Scheduler Package

English version: [README.md](./README.md)

## 架构概述

`@vole/scheduler` 负责**后台任务执行边界**：任务运行记录持久化、无人值守执行的安全审批策略，以及基于 cron 的任务调度。它位于 Agent 运行时和文件系统之间，是连接实时交互式会话与长时间后台工作的桥梁。

```
CronScheduler（基于定时器）
    │  调用 runner
    ▼
TaskRunner（调用者提供，通常封装 AgentRuntime）
    │  持久化到
    ▼
JsonlTaskStore    ←── 任务运行历史（JSONL 文件）
    │
BackgroundApprovalResolver  ←── 注入 AgentRuntime 用于无人值守运行
```

## 核心概念

### TaskDefinition

描述一个命名 Agent 任务，可选地包含 cron 计划：

```typescript
interface TaskDefinition {
  name: string;
  goal: string;       // 发送给 AgentRuntime 的用户消息
  cron?: string;      // "分 时 日 月 周" 标准 5 字段格式
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

无 `cron` 字段时为一次性任务，由调用者显式触发。

### TaskRunRecord

一次任务执行的持久化记录，包含 `id`、`taskName`、`goal`、`sessionId`、`startedAt`、可选的 `completedAt`、`status`（running/completed/failed）、`assistantText`、可选的 `errorMessage`。

### JsonlTaskStore

将任务运行记录持久化到单个 JSONL 文件：

- **`saveRun`**：追加新记录行（仅追加，不重写）。
- **`updateRun`**：读取所有记录，找到匹配 ID，合并更新，重写整个文件。
- **`listRuns`**：读取所有记录，可按 `taskName` 过滤，从尾部应用 `limit`。

父目录在首次写入前自动创建（`mkdir -p`）。

### BackgroundApprovalResolver

无人值守后台任务无法呈现交互式审批提示。`BackgroundApprovalResolver` 实现 `ApprovalResolver` 的简单规则：

| 模式 | 决策 |
|---|---|
| `"auto"` | `approved: true` — 自动批准所有工具调用 |
| `"confirm"`（默认） | `approved: false` — 自动拒绝；无用户在场 |
| `"observe"` | `approved: false` — 自动拒绝；无用户在场 |

**设计含义**：需要运行 Shell 命令或写入文件的后台任务应使用 `mode: "auto"`。在 `"confirm"` 模式下，一旦尝试调用中/高风险工具就会失败。

### matchesCron

解析标准 5 字段 cron 表达式（分 时 日 月 周），仅支持精确值和 `*` 通配符（不支持 `*/5` 步长值或范围）。这种有意简化的实现涵盖常见调度需求（每小时、每天、每周），无需 cron 解析器库依赖。

### CronScheduler

以可配置间隔（默认 30 秒）轮询到期任务：

- `start()`：开始轮询，立即执行一次。
- `stop()`：清除定时器。
- `get isRunning()`：当前运行状态。

**每分钟去重**：调度器将每个任务的最后运行时间记录为 `minuteKey`（Unix 时间戳按整分钟取整）。若任务的 `minuteKey` 与当前分钟相同则跳过，防止 30 秒轮询间隔在同一分钟内重复运行任务。

**故障隔离**：`runner(task)` 抛出异常时静默捕获，调度器继续处理剩余任务。

`getNow` 函数可注入，支持测试确定性时间行为。

### writeHeartbeat

```typescript
async function writeHeartbeat(filePath: string, state: HeartbeatState): Promise<void>

interface HeartbeatState {
  status: "idle" | "running" | "completed" | "failed";
  taskName?: string;
  runId?: string;
  lastUpdatedAt: string;  // ISO 8601
  message?: string;
}
```

在 `filePath` 写入结构化 Markdown 心跳文件，始终覆盖（不追加）。父目录自动创建。

文件内容对人类可读，且在 `HEARTBEAT.md` 存在时会注入到工作区 prompt 文件中：

```
# Heartbeat

**Status**: running
**Last updated**: 2026-05-07T10:00:00.000Z
**Task**: daily-summary
**Run ID**: run_abc123
```

CLI 适配器的 `runDaemonTask` 在两个时间点调用 `writeHeartbeat`：任务开始时（`status: "running"`）和任务结束时（`status: "completed"` 或 `"failed"`）。无论 agent 是否在任务中途调用 `update_heartbeat`，这都保证 `HEARTBEAT.md` 反映 daemon 的当前状态。

## 实现原理

### 为何 JSONL 用于任务运行

任务运行是追加密集型（持续添加新记录），偶尔读取（获取最近 N 次运行）。JSONL 天然适合：追加 O(1)，读取所有记录用于列表也很直接。与会话 JSONL 不同，任务运行更新需要完整重写（状态从 `running` 变为 `completed`）。这对预期持有数百条记录的小型任务历史是可接受的。

### 为何调度器与 Core 分离

调度器包含后台特定逻辑（cron 匹配、无人值守审批），这些逻辑会给核心运行时增加不必要的复杂性。调度器从 `@vole/core` 导入 `ApprovalResolver`，但不导入 `AgentRuntime`——它操作 `TaskRunner`，一个调用者提供的由 CLI 连接到 `AgentRuntime` 实例的函数。这保持了依赖方向的清晰。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 scheduler 包，依赖 `@vole/core` 和 `@vole/sessions`。 |
| `tsconfig.json` | TypeScript 配置 | 使用对 core 和 sessions 的项目引用构建 scheduler。 |
| `src/index.ts` | 调度器 | 所有导出：`TaskDefinition`、`TaskRunRecord`、`TaskStore`、`JsonlTaskStore`、`BackgroundApprovalResolver`、`matchesCron`、`CronScheduler`、`CronSchedulerOptions`、`TaskRunner`、`HeartbeatState`、`writeHeartbeat`。 |
| `src/index.test.ts` | 调度器测试 | 保护任务存储 CRUD、`BackgroundApprovalResolver` 模式行为、`matchesCron` 通配符和精确匹配、`CronScheduler` 启停/去重/故障隔离、`writeHeartbeat` 文件格式。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

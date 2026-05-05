# TaskFlow Package

English version: [README.md](./README.md)

## 架构概述

`@arvinclaw/taskflow` 负责**持久化的跨会话任务图**：存储和查询跨多个会话、Adapter 和运行时类型的任务记录。`@arvinclaw/sessions` 存储会话内的对话历史，而 `@arvinclaw/taskflow` 追踪所有会话中各个任务的生命周期。

```
spawn_subagent_async  ──创建──▶
CronScheduler         ──创建──▶   JsonlTaskFlowStore   ←── 任务图（JSONL）
CLI task 命令         ──创建──▶
```

## 核心概念

### TaskRecord

```typescript
interface TaskRecord {
  id: string;
  runtime: TaskRuntime;       // "subagent" | "background" | "cli" | "cron" | "web"
  task: string;               // 目标描述
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  progressSummary?: string;   // 进行中状态描述
  terminalSummary?: string;   // 最终结果描述
  parentId?: string;          // 子任务层次结构的父任务 ID
  sessionId?: string;         // 关联的 session ID
}
```

### TaskStatus

七种终态和非终态：

| 状态 | 终态? | 含义 |
|---|---|---|
| `"queued"` | 否 | 已创建，尚未开始 |
| `"running"` | 否 | 当前执行中 |
| `"waiting"` | 否 | 暂停，等待依赖或审批 |
| `"blocked"` | 否 | 无法继续（依赖失败） |
| `"succeeded"` | 是 | 成功完成 |
| `"failed"` | 是 | 失败完成 |
| `"cancelled"` | 是 | 被显式取消 |
| `"lost"` | 是 | 进程终止前未记录终态 |

### TaskRuntime

`"subagent"` | `"background"` | `"cli"` | `"cron"` | `"web"` — 标识任务的发起方式，用于过滤和显示。

### TaskFlowStore 接口

- `create(record)` — 添加新任务记录，自动注入 `createdAt`/`updatedAt`。
- `update(id, updates)` — 仅可更新 `status`、`progressSummary`、`terminalSummary`（结构字段不可变）。
- `get(id)` — 按 ID 查找，不存在时返回 `undefined`。
- `list(query?)` — 支持按 `status`、`parentId` 过滤和 `limit` 截取。

## 实现原理

### JsonlTaskFlowStore：读-改-写模式

与 `JsonlSessionStore`（仅追加）不同，`JsonlTaskFlowStore` 对更新使用**读-改-写**模式：

1. 从 JSONL 文件读取所有记录。
2. 找到匹配 ID 的记录。
3. 合并更新并更新 `updatedAt`。
4. 重写整个文件。

这允许状态变化在文件中原地反映，无需维护独立索引。代价是 O(n) 的更新成本，对预期持有数百条记录的任务列表是可接受的。

`create()` 追加新记录行后立即重写完整文件（包含新记录）以保持格式一致。父目录自动创建。

### 父子任务图

`parentId` 字段支持 subagent 派生的树状任务追踪：

```
父任务（cli）
  └── 子任务 A（subagent，parentId = 父任务.id）
  └── 子任务 B（subagent，parentId = 父任务.id）
        └── 孙任务（subagent，parentId = 子任务B.id）
```

`list({ parentId: "…" })` 返回任务的所有直接子任务。完整子树遍历需要多次查询。

### 与 scheduler 的 JsonlTaskStore 的区别

`@arvinclaw/scheduler` 有自己的 `JsonlTaskStore`，用于调度器特定的 `TaskRunRecord` 对象（包含 `assistantText`、`completedAt`，与调度器运行生命周期紧密耦合）。`@arvinclaw/taskflow` 的 `JsonlTaskFlowStore` 存储 `TaskRecord`，具有更丰富的状态模型和父子关系，用于通用的跨会话任务图。两个存储服务于不同层次：调度器追踪执行历史，taskflow 追踪逻辑任务图。

### 与 AsyncTaskStore 的集成

`@arvinclaw/core` 定义了鸭子类型的 `AsyncTaskStore` 接口，供 `createSpawnSubagentAsyncTool` 在派生异步子 Agent 时记录任务 ID。`JsonlTaskFlowStore` 满足此接口（具有兼容签名的 `create()` 方法），调用者可直接将 `JsonlTaskFlowStore` 实例作为 `taskStore` 选项传入，无需显式适配器。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 taskflow 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 taskflow 包。 |
| `src/index.ts` | 任务流存储 | 所有导出：`TaskStatus`、`TaskRuntime`、`TaskRecord`、`TaskFlowStore`、`JsonlTaskFlowStore`、`taskflowPackageName`。 |
| `src/index.test.ts` | TaskFlow 测试 | 保护带时间戳的创建、update/get/list、status 和 parentId 过滤、limit，以及 ID 缺失时返回 `undefined`。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

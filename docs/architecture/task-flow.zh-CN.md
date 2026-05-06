# TaskFlow

状态：设计
日期：2026-05-05

English version: [task-flow.md](./task-flow.md)

## 1. 目的

`update_todos` 为单次运行提供 in-turn 任务可见性。它向用户展示 agent 当前正在做什么 — 但 session 结束时就消失了。

TaskFlow 填补持久协调层。它是一个持久的、跨 session 的任务图，从创建到完成、失败或取消，跨任意数量的 sessions 和 agent 运行，追踪长期运行目标的生命周期。

TaskFlow 设计用于：

- 跨越数天或数周的多步骤项目
- 跨 sessions 暂停和恢复的目标
- 用户离线时运行的后台任务
- 父子任务分解（一个目标，多个子任务）
- 审计跟踪：尝试了什么、成功了什么、失败了什么

核心规则：

`update_todos` 是 in-turn 展示。TaskFlow 是持久协调。它们服务于不同目的，互不替代。

## 2. TaskRecord 类型

`TaskRecord` 表示单个原子工作单元：

```typescript
interface TaskRecord {
  /** 此任务的唯一标识符。 */
  taskId: string;

  /** 拥有此任务的 AgentRuntime session ID。 */
  runtime: string;

  /** 此任务功能的人类可读描述。 */
  task: string;

  /** 当前生命周期状态。 */
  status: TaskStatus;

  /** 滚动进度摘要，由 agent 在执行过程中更新。 */
  progressSummary: string;

  /** 最终结果摘要，状态达到终止状态时设置。 */
  terminalSummary: string | null;

  /** 创建时的 ISO 时间戳。 */
  createdAt: string;

  /** 最后更新时的 ISO 时间戳。 */
  updatedAt: string;
}
```

## 3. TaskFlow 类型

`TaskFlow` 表示可能分解为多个 `TaskRecord` 步骤的更高级别目标：

```typescript
interface TaskFlow {
  /** 此 flow 的唯一标识符。 */
  flowId: string;

  /** 顶级目标描述。 */
  goal: string;

  /** 当前执行的 TaskRecord ID（等待或未开始时为 null）。 */
  currentStep: string | null;

  /** 如果状态为 "blocked"，描述 flow 为何被阻塞的摘要。 */
  blockedSummary: string | null;

  /** Agent 可以在 sessions 间读写的任意 JSON 状态。 */
  stateJson: string;

  /** 如果是 sub-flow，则为父 flow ID。 */
  parentFlowId: string | null;

  /** 直接子 flow 的 IDs。 */
  childFlowIds: string[];

  /** 当前生命周期状态。 */
  status: TaskStatus;

  /** 创建时的 ISO 时间戳。 */
  createdAt: string;

  /** 最后更新时的 ISO 时间戳。 */
  updatedAt: string;
}
```

`stateJson` 是一个自由格式的 JSON blob，agent 可以用它在 sessions 之间持久化中间结果、未解决问题或部分输出。

## 4. 状态生命周期

`TaskRecord` 和 `TaskFlow` 共享相同的状态类型：

```typescript
type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";
```

状态转换：

```
queued → running → succeeded
                 → failed
                 → cancelled
       → waiting → running
                 → cancelled
       → blocked → running（解除阻塞后）
                 → cancelled

任何非终止状态 → lost（如果 agent 进程在未完成时死亡）
```

终止状态（`succeeded`、`failed`、`cancelled`、`lost`）无法转换到其他状态。

`lost` 由 runtime 在恢复期间设置，当 `running` 任务没有活动 session 且没有最近心跳时。

## 5. 模式

TaskFlow 支持两种协调模式：

### 托管模式（Managed Mode）

TaskFlow 驱动执行。Runtime 从 `TaskFlow.currentStep` 读取当前步骤，为其启动 session，运行直到完成，更新步骤状态，然后前进到下一步。

托管模式适用于：

- 自主多步骤项目
- 后台自动化 flows
- 定时重复目标

### 镜像模式（Mirrored Mode）

TaskFlow 观察并记录外部驱动的执行。Agent 在完成步骤时更新 TaskFlow 状态，但 flow 不驱动 agent 启动。

镜像模式适用于：

- 用户想要持久进度追踪的手动 sessions
- 另一个系统驱动执行顺序的集成

## 6. 存储

初始实现在 workspace 的 `.peewit/flows/` 下为每个 flow 使用 JSONL 文件：

```
.peewit/
  flows/
    <flowId>.jsonl   # 每个 flow 一个 append-only 事件日志
```

JSONL 文件中的每行是一个状态转换事件。通过重放日志中的事件来计算当前状态。

未来：迁移到 SQLite，以支持索引查询、高效状态查找和跨 flow 关系查询。

存储模块接口：

```typescript
interface TaskFlowStore {
  createFlow(flow: TaskFlow): Promise<void>;
  getFlow(flowId: string): Promise<TaskFlow | null>;
  updateFlow(flowId: string, patch: Partial<TaskFlow>): Promise<void>;
  listFlows(filter?: { status?: TaskStatus }): Promise<TaskFlow[]>;
  createRecord(record: TaskRecord): Promise<void>;
  getRecord(taskId: string): Promise<TaskRecord | null>;
  updateRecord(taskId: string, patch: Partial<TaskRecord>): Promise<void>;
}
```

## 7. 与 update_todos 的关系

`update_todos` 和 TaskFlow 服务于不同角色：

| 维度 | `update_todos` | TaskFlow |
| --- | --- | --- |
| 持久性 | Turn 期间的内存中 | 跨 sessions 持久 |
| 范围 | 仅当前运行 | 多个 sessions，多次运行 |
| 可见性 | 执行期间的 CLI 展示 | CLI、Web、后台查询 |
| 驱动者 | 模型（tool 调用） | Runtime 调度器或模型 |
| 恢复 | 无（短暂的） | Lost 检测 + 恢复 |
| 结构 | 步骤的扁平列表 | flows 和 records 的树 |

两个系统可以共存：`update_todos` 提供实时的运行中可见性，而 TaskFlow 追踪更大目标的持久状态。

## 8. OpenClaw 对齐

OpenClaw 实现了类似 TaskFlow 的持久任务图。关键对齐：

| OpenClaw 概念 | Peewit 等效 |
| --- | --- |
| 带状态生命周期的 `TaskRecord` | `TaskRecord` 类型 |
| 带父子关系的 `TaskFlow` | 带 `parentFlowId`/`childFlowIds` 的 `TaskFlow` 类型 |
| JSONL 事件日志存储 | `.peewit/flows/<flowId>.jsonl` |
| SQLite 迁移路径 | 计划在未来阶段 |
| 死 session 的 `lost` 状态 | `"lost"` 状态 |
| 跨 session 状态的 `stateJson` | `stateJson: string` 字段 |

OpenClaw 的实现确认 JSONL 是正确的起点：简单、人类可读且易于迁移。

## 9. 验收标准

TaskFlow 在满足以下条件时视为完成：

- `TaskRecord` 和 `TaskFlow` 类型已实现并存储在 JSONL 中。
- 状态生命周期转换被执行（无无效转换）。
- 在恢复期间，当运行中任务没有活动 session 时，分配 `lost` 状态。
- 托管模式为 `queued` 步骤驱动 session 启动。
- 镜像模式允许 agent 在没有 runtime 调度的情况下更新 flow 状态。
- 父子 flow 关系被存储且可查询。
- `TaskFlowStore` 接口为 JSONL 实现。
- 单元测试覆盖：状态转换、lost 检测、JSONL 事件重放、父子链接。

## 10. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [Background Automation](./background-automation.zh-CN.md)
- [Run Queue](./run-queue.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

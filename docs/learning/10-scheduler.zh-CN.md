# 模块 10：@vole/scheduler

状态：已完成
日期：2026-05-07

英文版：`10-scheduler.md`

相关源码：`packages/scheduler/src/index.ts`

## 0. 如何使用本文档

本文档属于学习指南第三阶段（基础层模块）。
请在 [07-sessions.zh-CN.md](./07-sessions.zh-CN.md) 之后阅读——scheduler 使用了
`JsonlSessionStore` 和 `AgentRuntime`，需要先理解这两个概念。

**阅读前**：通读 `packages/scheduler/src/index.ts`（207 行）。有四个导出：
`TaskDefinition`、`JsonlTaskStore`、`BackgroundApprovalResolver`、`CronScheduler`。
注意它们互不了解对方——组装发生在 CLI 层。

**聚焦问题**：
- `saveRun` 追加写；`updateRun` 读取-修改-写入。为什么不对称？
- `BackgroundApprovalResolver` 有三种 mode，但只有两种结果。各是什么，哪种 mode 对应哪种结果？
- `CronScheduler` 每 30 秒 tick 一次。同一分钟内任务会执行两次吗？追踪完整代码路径。
- `matchesCron("*/5 * * * *", now)` 返回什么，为什么？

**检查点**：能够描述从 `.task.json` 文件到 `task-runs.jsonl` 中一条完整 `TaskRunRecord`
的全流程，并解释为什么需要 `BackgroundApprovalResolver`，即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：把 scheduler 想象成夜班警卫。白天（交互式会话）有人在场，每个重要动作都经过用户批准。
晚上（后台任务）警卫自主处理——但规则取决于事先授予的信任级别：只观察、总是拒绝、还是全权自动批准。
本模块提供警卫需要的工具：记录本（`JsonlTaskStore`）、固定审批策略（`BackgroundApprovalResolver`）、
以及在正确分钟叫醒他的定时器（`CronScheduler`）。

**技术总结**：`@vole/scheduler` 提供三个正交的后台执行原语。`JsonlTaskStore` 将任务运行记录（状态、
输出、时间）持久化到 JSONL 文件。`BackgroundApprovalResolver` 实现 `ApprovalResolver` 接口，
为无人值守运行提供固定策略：`auto` 模式自动批准，`confirm`/`observe` 模式自动拒绝。`CronScheduler`
基于 cron 表达式调用 `TaskRunner` 回调，使用 30 秒轮询加每分钟去重。CLI 将三者组装为
`runDaemonTask`。

## 2. 为什么这个模块存在

没有 scheduler，Vole 纯粹是被动的——只在人发消息时才行动。很多有用的任务是时间驱动的：每日摘要、
每小时健康检查、定期研究更新。Scheduler 增加了推送模型：基于时钟触发的任务，而非人工触发。

后台执行也需要不同的审批姿态。交互式会话有人可以回答"是，执行那个命令"。后台会话没有。
`BackgroundApprovalResolver` 在构造时就明确审批策略，而不是在每次工具调用时——模式在执行开始前就决定了。

## 3. 公开接口

```ts
// 从 .task.json 文件加载或直接传入的任务定义
interface TaskDefinition {
  name: string
  goal: string
  cron?: string              // 标准 5 字段 cron 表达式
  mode?: "observe" | "confirm" | "auto"
  maxSteps?: number
}

// 一次任务执行记录
interface TaskRunRecord {
  id: string
  taskName: string
  goal: string
  sessionId: string
  startedAt: string          // ISO 8601
  completedAt?: string
  status: "running" | "completed" | "failed"
  assistantText: string      // 最终 assistant 响应文本
  errorMessage?: string
}

interface TaskStore {
  saveRun(record: TaskRunRecord): Promise<void>
  updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>
  listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>
}

class JsonlTaskStore implements TaskStore { ... }

class BackgroundApprovalResolver implements ApprovalResolver {
  constructor(mode?: "observe" | "confirm" | "auto")  // 默认 "confirm"
  resolve(request: ApprovalRequest): Promise<ApprovalResolution>
}

function matchesCron(expression: string, date: Date): boolean

type TaskRunner = (task: TaskDefinition) => Promise<void>

class CronScheduler {
  constructor(tasks: TaskDefinition[], runner: TaskRunner, options?: CronSchedulerOptions)
  start(): void
  stop(): void
  get isRunning(): boolean
}
```

## 4. 实现走读

### 任务生命周期：两阶段写入

任务记录写两次。第一次在执行开始时：

```ts
const initialRecord = { id, taskName, goal, sessionId, startedAt, status: "running", assistantText: "" }
await taskStore.saveRun(initialRecord);  // 追加到 JSONL
```

第二次在 `runTurn` 完成后：

```ts
await taskStore.updateRun(runId, { status, assistantText, completedAt, errorMessage? })
```

`saveRun` 追加新行——快速且纯追加。`updateRun` 读取整个文件，按 `id` 修补匹配记录，然后重写整个文件。
这种不对称是因为：

- **保存**：记录只创建一次，不需要合并——纯追加是正确的。
- **更新**：可变状态（状态从 `running` 转变为 `completed`/`failed`）必须覆盖原始记录。

这与 `@vole/sessions` 不同，sessions 的所有 JSONL 记录是不可变事件。TaskRunRecord 是实体状态，
不是事件日志。

### BackgroundApprovalResolver：构造时确定策略

```ts
async resolve(_request: ApprovalRequest): Promise<ApprovalResolution> {
  if (this.#mode === "auto") {
    return { approved: true, reason: "Auto-approved in background auto mode." };
  }
  return { approved: false, reason: `Auto-denied in background ${this.#mode} mode: no user is present...` };
}
```

三种 mode，两种结果：
- `auto` → 批准一切
- `confirm` → 拒绝一切（请求需要人工，但没有人）
- `observe` → 拒绝一切（只读意图，副作用被阻止）

`_request` 参数完全被忽略——决策由构造时决定，与工具调用内容无关。这是有意的：后台任务在开始前
就承诺了一种模式，而不是逐个工具调用地决定。

### CronScheduler：30 秒轮询 + minuteKey 去重

```ts
async #tick(): Promise<void> {
  const now = this.#getNow();
  for (const task of this.#tasks) {
    if (!task.cron) continue;
    if (!matchesCron(task.cron, now)) continue;

    const lastRun = this.#lastRun.get(task.name) ?? 0;
    const minuteKey = Math.floor(now.getTime() / 60_000);
    if (lastRun === minuteKey) continue;        // 本分钟已执行过

    this.#lastRun.set(task.name, minuteKey);
    try {
      await this.#runner(task);
    } catch { /* 单个任务失败不停止调度器 */ }
  }
}
```

调度器每 30 秒（默认）tick 一次，但 `minuteKey`（`ms / 60_000` 向下取整）确保每个任务每分钟最多
执行一次。30 秒间隔是可靠性选择：如果某次 tick 恰好错过了从 `:59` 到 `:00` 的时钟变化，30 秒后
的下一次 tick 会补上。

### matchesCron：最小语法

```ts
function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}
```

支持：`*`（通配）和精确整数。不支持：`*/5`（步进）、`1-5`（范围）、`1,3,5`（列表）。

这意味着 `*/5 * * * *` 不会每 5 分钟运行一次——`*/5` 字段 `parseInt` 返回 `NaN`，`!isNaN(num)`
检查失败，函数对每一分钟都返回 `false`。

支持集合涵盖了最常见的后台调度：`0 9 * * *`（每天 9 点）、`0 * * * *`（每小时）、
`* * * * *`（每分钟，用于测试）。

### 磁盘上的任务文件

任务存放在 sessions 目录旁边的 `tasks/` 目录中：

```
~/.vole/sessions/task-runs.jsonl
~/.vole/tasks/daily-summary.task.json
~/.vole/tasks/hourly-health.task.json
```

每个 `.task.json` 是一个 `TaskDefinition` 对象：

```json
{
  "name": "daily-summary",
  "goal": "读取今天的会话并向 notes/daily.md 写入一段摘要",
  "cron": "0 22 * * *",
  "mode": "auto",
  "maxSteps": 10
}
```

`loadTaskDefinitions` 读取目录中所有 `*.task.json` 文件。daemon 只过滤定义了 `cron` 的子集。

### CLI 组装：runDaemonTask

CLI 的 `runDaemonTask` 函数将三个原语组装为一次执行：

```
TaskDefinition
  → BackgroundApprovalResolver(task.mode ?? "auto")
  → AgentRuntime({ approvalResolver, tools, modelProvider, ... })
  → runtime.runTurn({ sessionId, message: task.goal })
  → 收集事件
  → taskStore.updateRun(runId, { status, assistantText })
```

每次后台运行都有独立的 `sessionId` 和 `AgentRuntime` 实例——运行之间不复用会话。
设置 `preferStreaming: false` 是因为没有终端可渲染。

## 5. OpenClaw 对齐

| OpenClaw | Vole | 说明 |
|---|---|---|
| 有审批策略的后台任务执行 | `BackgroundApprovalResolver` | 相同的三种 mode |
| 任务运行持久化 | `JsonlTaskStore` | OpenClaw 用 SQLite；Vole 用 JSONL |
| 带去重的 Cron 调度 | `CronScheduler` + `minuteKey` | 相同概念 |
| 任务定义文件 | `tasks/` 中的 `.task.json` | OpenClaw 用 TOML；Vole 用 JSON |
| Daemon 模式（调度器 + 信号处理） | CLI 中的 `runDaemon` | 相同的 SIGTERM/SIGINT 模式 |

## 6. 关键设计决策

**审批策略在构造时决定，而非逐次调用**

`BackgroundApprovalResolver` 忽略 `ApprovalRequest` 内容，根据 `mode` 返回固定答案。
这意味着策略在后台运行开始时声明一次，而不是每次工具调用时评估。好处：行为清晰、可审计。
`confirm` 模式任务永远不会批准工具调用，不管工具是什么。

**两阶段 JSONL 写入：追加再重写**

保存新运行是纯追加；更新已有运行重写整个文件。这是正确的，因为 `TaskRunRecord` 是实体（有 id
和可变状态），不是事件。纯追加写入需要类似墓碑-回放的方案来重建当前状态，对小文件来说增加了
不必要的复杂度。

**30 秒 tick + minuteKey，而非精确调度**

间隔定时器在高负载下可能漂移或漏 tick。30 秒 tick 提供两次机会来捕捉每个分钟边界。`minuteKey`
防止两次 tick 恰好在同一分钟内触发双重执行。这比计算精确下次触发时间更简单可靠。

**matchesCron 只支持 `*` 和精确整数**

最小语法涵盖了所有实际日常调度。支持步进（`*/5`）和范围（`1-5`）需要更复杂的解析器。
由于 Vole 当前内置任务不需要这些模式，暂时推迟实现。风险：写了 `*/30 * * * *` 期望
"每 30 分钟"的用户会得到沉默，没有错误提示。

**TaskStore 没有 InMemory 变体**

`JsonlTaskStore` 的测试使用真实临时目录。存储足够简单，真实文件系统测试比维护 fake 更省力。
这与 `@vole/sessions` 形成对比，sessions 增加了 `InMemorySessionStore` 用于测试隔离——
session store 有更复杂的交互，受控的内存实现更有价值。

## 7. 测试方式

测试在 `packages/scheduler/src/index.test.ts` 中，三个组件都有测试：

- **`JsonlTaskStore`**：保存/列出、多条记录、limit 过滤、taskName 过滤、updateRun 修补正确记录、
  文件不存在时返回空数组、自动创建父目录
- **`BackgroundApprovalResolver`**：confirm 拒绝、observe 拒绝、auto 批准、
  默认（无参数）像 confirm 一样拒绝
- **`matchesCron`**：通配符匹配任意日期、精确分钟+小时、错误小时返回 false、
  无效表达式（字段数错误）返回 false
- **`CronScheduler`**：cron 匹配时运行任务、同一分钟不重复执行（去重）、
  非匹配 cron 跳过、start/stop 生命周期

`CronScheduler` 测试使用 `getNow` 注入来控制时钟，无需真实定时器。

## 8. 洞察

**Scheduler 将调度与执行解耦。** `CronScheduler` 对 `AgentRuntime`、sessions 或工具一无所知。
它调用 `TaskRunner` 回调——回调做什么完全由调用方决定。这让调度器极易测试：注入 `vi.fn()` 并
验证它被调用了一次。

**`BackgroundApprovalResolver` 强制执行"后台运行不能阻塞"的契约。** 交互式会话阻塞在
`ApprovalResolver.resolve()` 等待用户输入。后台会话绝不能阻塞。`BackgroundApprovalResolver`
立即以确定性答案 resolve，`AgentRuntime` 永远不会等待人工操作。

**任务记录是审计跟踪。** `TaskRunRecord` 为每次后台运行记录了 `assistantText`、`status`、
`completedAt` 和 `errorMessage`。即使会话 JSONL 后来被压缩或删除，任务存储也保存了 agent
做了什么、是否成功的人类可读摘要。这是后台运行相当于对话历史的等价物。

**`once` 模式让 daemon 可以作为 cron 任务使用。** `runDaemon(options, once=true)` 立即运行
所有 cron 任务一次然后退出——没有调度器，没有信号处理。这允许系统调度器（Linux cron、launchd）
控制时机，Vole 作为执行器。内置 `CronScheduler` 只在运行持久化 daemon 更方便时才使用。

## 9. 复习问题

1. `saveRun` 追加；`updateRun` 重写。为什么不让两者都纯追加？
   > `TaskRunRecord` 是可变实体状态（status 从 `running` 变为 `completed`）。纯追加需要
   > 回放所有记录来找到任意运行的当前状态，增加了复杂度。文件小（每次执行一条记录），重写代价低。
   > 对比 sessions JSONL 是纯追加的，因为 session 事件是不可变的——它们从不原地更新。

2. 一个任务处于 `confirm` 模式。执行期间 agent 调用 shell 工具，permissions 模块返回 `ask`。
   会发生什么？
   > 调用 `BackgroundApprovalResolver.resolve()`。因为 mode 是 `confirm`（不是 `auto`），
   > 它立即返回 `{ approved: false }` 而不读取请求内容。`AgentRuntime` 收到拒绝，工具调用失败。
   > 运行继续，但 shell 命令从未执行。最终 `status` 是 `completed`（不是 `failed`）——除非失败
   > 导致下游错误传播到 `run_failed`。

3. `matchesCron("*/5 * * * *", now)` 返回什么？
   > 对 `now` 的任何值都返回 `false`。`matchesCronField("*/5", minutes)` 调用
   > `parseInt("*/5", 10)` 返回 `NaN`。`!isNaN(num)` 检查失败，字段永远不匹配。
   > 表达式被静默视为无效——`matchesCron` 返回 `false`，就像表达式永远不匹配，而不是报错。

4. 同一分钟内 cron 任务会执行两次吗？
   > 不会。`#tick()` 计算 `minuteKey = Math.floor(now.getTime() / 60_000)` 并与 `#lastRun`
   > 比较。如果任务在本分钟已经运行过，则跳过。`#lastRun` map 在 `CronScheduler` 实例的生命
   > 周期内持久存在。

5. `runDaemon` 中的 `once` 模式是什么，何时使用？
   > `once=true` 立即运行所有带 cron 的任务一次然后退出。当系统调度器（cron、launchd）处理时间
   > 时使用——Vole 成为单次执行器而非持久化 daemon。内置 `CronScheduler` 只在 `once=false` 时
   > 启动。

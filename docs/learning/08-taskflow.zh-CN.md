# 模块 08：@vole/taskflow

状态：已完成
日期：2026-05-07

英文版本：`08-taskflow.md`

相关源码：`packages/taskflow/src/index.ts`

## 0. 如何使用本文档

本文档属于[学习指南](./guide.zh-CN.md)第三阶段（基础模块）的一部分。
请在阅读 [07-sessions.zh-CN.md](./07-sessions.zh-CN.md) 之后阅读本文档——两者都使用 JSONL 存储，但写入策略有关键差异：sessions 追加写入，taskflow 全文件重写。

**阅读前**：完整阅读 `packages/taskflow/src/index.ts`。这个文件很短（103 行）。注意 `TaskStatus` 的 8 个状态值和 `TaskRuntime` 的 5 个值。

**重点问题**：
- `progressSummary` 和 `terminalSummary` 有什么区别？
- 为什么 `update()` 要重写整个文件而不是追加？
- `parentId` 实现了什么，又没有强制约束什么？
- `limit` 是返回前 N 条还是最后 N 条记录？

**检查点**：当你能够描述三次任务创建和一次状态更新后 `tasks.jsonl` 文件的样子，并解释为什么更新会触发全文件重写时，说明你理解了本模块。

## 1. 通俗易懂：这个模块做什么

**打个比方**：`@vole/taskflow` 就像控制室墙上的白板。每一个提交的任务——无论是正在执行、排队等待，还是已经完成——都会在白板上有一张卡片。你可以查看卡片来了解当前状态，添加新卡片，或者翻转卡片更新状态。与日记本（从不擦除内容）不同，白板记录的是当前状态：如果一个任务完成了，你更新那张卡片——而不是再贴一张新卡片。

**技术概要**：`@vole/taskflow` 将跨会话的任务记录持久化到一个 JSONL 文件中。每行是一条 `TaskRecord`。与追加写入的 `@vole/sessions` 不同，`JsonlTaskFlowStore` 使用**读取-修改-写入**策略：每次 `update()` 读取所有记录，在内存中修改目标记录，然后重写整个文件。这样每个任务始终是一行反映当前状态的权威记录。

## 2. 为什么需要它

Sessions 追踪对话历史——说了什么。Taskflow 追踪任务状态——做了什么、正在做什么、什么失败了。这是不同的关注点，有不同的更新语义。

对话历史是向前增长的：始终追加。任务状态是可变的实体：`queued → running → succeeded`。如果任务也用追加事件存储，读取当前状态就需要对每个任务重放所有状态转换——类似于跨事件的 join 操作。Taskflow 通过为每个任务保持一条带有当前状态的记录来避免这个问题。

Taskflow 还通过 `parentId` 建立子任务关系，支持父任务创建子任务并追踪结果的多 agent 工作流。

## 3. 公共接口

```ts
type TaskStatus =
  | "queued"      // 等待开始
  | "running"     // 正在执行
  | "waiting"     // 暂停，等待外部信号
  | "blocked"     // 无法继续（依赖未满足或出错）
  | "succeeded"   // 成功完成
  | "failed"      // 完成但出错
  | "cancelled"   // 被显式停止
  | "lost"        // 运行时异常退出，未报告结果

type TaskRuntime = "subagent" | "background" | "cli" | "cron" | "web"

interface TaskRecord {
  id: string
  runtime: TaskRuntime
  task: string           // 目标/描述（自由文本）
  status: TaskStatus
  createdAt: string
  updatedAt: string
  progressSummary?: string    // 实时进度——执行过程中更新
  terminalSummary?: string    // 最终结果——完成或失败时设置
  parentId?: string           // 父任务 ID（用于子任务）
  sessionId?: string          // 关联的会话 ID
}

interface TaskFlowStore {
  create(record: Omit<TaskRecord, "createdAt" | "updatedAt">): Promise<TaskRecord>
  update(id: string, updates: Partial<Pick<TaskRecord, "status" | "progressSummary" | "terminalSummary">>): Promise<TaskRecord | undefined>
  get(id: string): Promise<TaskRecord | undefined>
  list(query?: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<TaskRecord[]>
}
```

一种实现：`JsonlTaskFlowStore`（没有内存版本）。

## 4. 实现详解

### 存储格式

两次任务创建后的 `tasks.jsonl` 文件如下所示：

```jsonl
{"id":"task_1","runtime":"cli","task":"编写报告","status":"running","createdAt":"...","updatedAt":"..."}
{"id":"task_2","runtime":"subagent","task":"研究主题","status":"queued","createdAt":"...","updatedAt":"...","parentId":"task_1"}
```

每行是一条完整的 `TaskRecord`。没有类型包装（没有 `"type"` 字段）——与 sessions 不同，每一行始终是一条任务记录。

### 更新时读取-修改-写入

```ts
async update(id, updates) {
  const all = await this.#readAll()           // 1. 从文件读取所有记录
  const idx = all.findIndex(r => r.id === id) // 2. 找到目标记录
  if (idx === -1) return undefined
  const updated = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  all[idx] = updated                           // 3. 在内存中修改
  await this.#writeAll(all)                   // 4. 重写整个文件
  return updated
}
```

这与 session 的重放模式相反。Sessions 从不修改已有行；taskflow 每次写入都替换整个文件。

### `#readAll()` 对缺失文件静默处理

```ts
async #readAll() {
  try {
    const content = await readFile(this.#filePath, "utf-8")
    return content.split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l))
  } catch {
    return []  // 文件尚不存在
  }
}
```

任何错误（包括 `ENOENT`）都返回空数组。第一次调用 `create()` 会通过 `#writeAll()` 创建文件。

### `limit` 返回最后 N 条，不是前 N 条

```ts
if (query?.limit !== undefined) records = records.slice(-query.limit)
```

`slice(-N)` 返回最后 N 条记录——最近创建的任务。这符合"显示最近 10 个任务"的常见 UI 预期，而不是最早的任务。

## 5. OpenClaw 对照

| OpenClaw | Vole | 说明 |
|---|---|---|
| 任务图 / 作业队列 | `JsonlTaskFlowStore` | OpenClaw 使用带索引的数据库；Vole 使用平坦 JSONL |
| 任务状态状态机 | `TaskStatus`（8 个值） | 相似的终态（succeeded、failed、cancelled）|
| 子 agent 任务 | `TaskRecord` 上的 `parentId` | OpenClaw 也类似地建模任务树 |
| `lost` 状态 | `TaskStatus = "lost"` | 处理崩溃恢复——运行时异常退出未报告结果 |

OpenClaw 的任务存储支持带索引的查询（按状态、按父任务过滤，支持分页）。Vole 的 `JsonlTaskFlowStore` 支持相同的过滤方式，但通过读取所有记录后在内存中过滤来实现。

## 6. 关键设计决策

**读取-修改-写入，而不是追加写入**

Sessions 使用追加写入，因为对话历史是不可变日志——你永远不会回去修改说过的话。任务是可变实体——状态随着执行而变化。使用读取-修改-写入让每个任务保持为一条带有当前状态的权威记录。读取当前状态时，每个任务查找是 O(1)，而不是 O(N) 的事件重放。

权衡：重写不是原子的。如果进程在写入过程中崩溃，文件可能损坏。Sessions 的追加写入设计避免了这个问题，因为旧行从不被修改。Taskflow 接受这个风险，因为任务状态是可恢复的（崩溃的任务可以在下次启动时标记为 `lost`），但对话历史无法重建。

**`lost` 作为明确的终态**

`"lost"` 表示正在执行任务的运行时异常退出，没有报告任何结果。它与 `"failed"` 不同（`"failed"` 意味着任务运行到完成但产生了错误）。下次启动时，系统可以查询崩溃前处于 `"running"` 状态的任务，将它们转换为 `"lost"`，使崩溃恢复变得明确且可审计。

**`progressSummary` vs `terminalSummary`**

这两个字段对应两个不同的阶段：
- `progressSummary`：执行过程中更新，提供实时状态（"已处理 7 个文件中的 3 个"）
- `terminalSummary`：完成或失败时一次性设置（"在 4.2 秒内完成，写入了 7 个文件" / "失败：超过速率限制"）

分开它们可以防止终态结果被进行中的更新覆盖，并让 UI 在任务运行时和完成后展示不同的信息。

**`parentId` 创建树结构，而不是 DAG**

`parentId` 是一个简单的字符串引用——store 不强制执行图遍历。任务可以引用任何其他任务作为父任务，包括尚不存在或已经完成的任务。Store 不验证父任务是否存在，不强制父子生命周期耦合，也不防止循环。如果需要这些约束，它们由调用方负责。

**没有内存实现**

与 `@vole/sessions` 不同，没有 `InMemoryTaskFlowStore`。测试使用真实临时文件（`mkdtemp`）。这是可接受的，因为 `JsonlTaskFlowStore` 已经优雅地处理了文件缺失情况（读取时返回 `[]`），使测试设置非常简单。

## 7. 测试方式

测试在 `packages/taskflow/src/index.test.ts` 中。所有测试使用真实临时目录和真实 `.jsonl` 文件——不使用模拟。

测试类别：
- 带自动生成时间戳的任务创建
- 状态更新和 `updatedAt` 刷新
- `update()` 对未知 ID 返回 `undefined`
- 按 ID `get()` 和缺失 ID
- `list()` — 所有记录
- `list({ status })` — 按状态过滤
- `list({ parentId })` — 子任务树
- `list({ limit })` — 最后 N 条记录（不是前 N 条）

## 8. 深入洞察

**Taskflow 和 sessions 是互补的持久化层。** Sessions 追踪 agent 说了什么和做了什么（对话历史 + 追踪事件）。Taskflow 追踪存在哪些工作以及处于什么状态（任务图）。会话是短暂的——对话结束时它也结束。任务可能比会话存活更长——在一个会话中创建的后台任务可能在另一个会话中完成。

**`runtime` 字段是分类，不是路由键。** `TaskRuntime` 记录任务在哪里被创建（`cli`、`web`、`cron`）或如何执行（`subagent`、`background`）。它是用于过滤和展示的元数据——它不决定任务如何被调度。

**文件不是追加写入的——这是有意的，但意味着它有不同的崩溃特性。** 追加写入在崩溃时保留之前的记录完好。重写崩溃可能留下部分写入的文件。在实践中，现代操作系统上的 `writeFile` 在 OS 级别要么完成要么失败（通过 rename），但这个实现没有使用 `fs.rename`——它直接写入。这是当前规模下被接受的限制。

**`limit` 从末尾切片。** `records.slice(-query.limit)` 意味着 `list({ limit: 5 })` 返回最近 5 个创建的任务。这与"显示最近的工作"一致，但如果你期望"显示最先创建的 5 个"会感到意外。在假设 limit 语义之前，请阅读实现。

## 9. 复习问题

1. `progressSummary` 和 `terminalSummary` 有什么区别？
   > `progressSummary` 是执行过程中写入的实时更新（"已处理 7 个项目中的 3 个"）。`terminalSummary` 是任务完成或失败时写入的最终结果。它们服务于不同的 UI：进度用于"现在发生了什么"，终态用于"结果是什么"。

2. 为什么 `update()` 要重写整个文件而不是追加？
   > 任务是可变实体，有单一的权威当前状态。如果更新被追加，读取当前状态需要对每个任务重放所有转换。读取-修改-写入让每个任务保持一条带有当前状态的记录，使每次任务查找是 O(1)，而不是 O(N) 的重放。

3. `"lost"` 状态意味着什么？它与 `"failed"` 有何不同？
   > `"failed"` 意味着任务运行到完成并产生了错误结果。`"lost"` 意味着正在执行任务的运行时异常退出（崩溃或被杀死），没有报告任何结果。下次重启时，崩溃前卡在 `"running"` 的任务可以转换为 `"lost"`，使崩溃恢复变得明确。

4. `parentId` 实现了什么，store 对它有哪些约束？
   > `parentId` 实现了子任务树——父任务可以创建独立追踪的子任务。Store 不强制任何约束：不验证父任务是否存在，不级联状态变化，也不防止循环。生命周期约束是调用方的责任。

5. 调用 `list({ limit: 3 })` 时，你会得到哪些记录？
   > 最后添加的 3 条记录（按文件中的插入顺序）。`slice(-3)` 返回数组的尾部。这返回最近创建的任务，而不是最旧的。

6. 当 `tasks.jsonl` 文件不存在时调用 `create()` 会发生什么？
   > `#readAll()` 捕获 `ENOENT` 错误并返回 `[]`。新记录被追加到这个空数组，然后 `#writeAll()` 在写入之前创建文件（及其父目录）。第一次 `create()` 调用透明地初始化文件。

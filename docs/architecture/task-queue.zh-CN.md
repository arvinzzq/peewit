# Task Queue

状态：活跃
日期：2026-05-11

English version: [task-queue.md](./task-queue.md)

## 1. 目的

Task queue 存储 task run 历史和 task definitions，使后台任务可检查和可恢复。

本文档描述 `TaskStore` 接口、`JsonlTaskStore` 实现、task definition 文件（未来）和 CLI 任务命令。

## 2. TaskStore 接口

```ts
interface TaskStore {
  saveRun(record: TaskRunRecord): Promise<void>;
  updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>;
  listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>;
}
```

`TaskStore` 是 task runs 的持久化契约。它与 `SessionStore` 分离，因为 task runs 有不同的元数据（status、taskName、goal）和不同的查询模式（按 task name 列出，按 status 列出）。

## 3. TaskRunRecord

```ts
interface TaskRunRecord {
  id: string;
  taskName: string;
  goal: string;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  assistantText: string;
  errorMessage?: string;
}
```

每个 `TaskRunRecord` 链接到 `sessionId`，以便可以从 `JsonlSessionStore` 检索完整 trace。`assistantText` 字段是紧凑摘要；完整 trace 保存在 session 文件中。

## 4. JsonlTaskStore

`JsonlTaskStore` 是 `TaskStore` 的 JSONL 支持实现。

- 文件路径：在构建时提供。通常为 `{sessionsDirectory}/task-runs.jsonl`。
- 格式：每行一条 JSON 记录（保存追加写入；更新全量重写）。
- `saveRun`：追加新记录。如目录不存在则创建。
- `updateRun`：读取所有记录，按 `id` 更新匹配记录，重写文件。
- `listRuns`：读取所有记录，如提供则按 `taskName` 过滤，返回最后 N 条（默认全部）。

```ts
class JsonlTaskStore implements TaskStore {
  constructor(filePath: string)
  async saveRun(record: TaskRunRecord): Promise<void>
  async updateRun(id: string, updates: Partial<TaskRunRecord>): Promise<void>
  async listRuns(query?: { limit?: number; taskName?: string }): Promise<TaskRunRecord[]>
}
```

选择 JSONL 格式的原因与 `JsonlSessionStore` 相同：人类可读、可追加写入、对部分写入具有弹性。

## 5. Task Definition 文件

Phase 8 不实现基于文件的 task definitions。任务目标直接作为 CLI 参数传递。

未来的文件格式可能如下：

```yaml
# .vole/tasks/daily-summary.yaml
name: daily-summary
goal: "Summarize the changes made to the workspace today."
mode: confirm
maxSteps: 8
```

`TaskDefinition` 接口设计为支持此扩展：

```ts
interface TaskDefinition {
  name: string;
  goal: string;
  mode?: "observe" | "confirm" | "auto";
  maxSteps?: number;
}
```

## 6. CLI 任务命令

### run 命令

```
vole run "<goal>"
vole run "<goal>" --mode auto|confirm
```

`run` 命令：

1. 从第一个非 flag 参数解析 goal。
2. 解析 `--mode`（默认：`confirm`）。
3. 调用 `runBackgroundTask(goal, mode, options)`。
4. 向 stdout 打印紧凑 trace。
5. 成功时打印 `Done: <assistantText>`。
6. 成功退出 0，失败退出 1。

### tasks 命令

```
vole tasks
vole tasks --limit N
```

`tasks` 命令：

1. 在 `{sessionsDirectory}/task-runs.jsonl` 打开 `JsonlTaskStore`。
2. 列出 runs（如提供则按 `--limit` 过滤）。
3. 每条 run 打印一行：`<id-suffix>  <taskName>  <status>  <startedAt>`。
4. 如果 store 为空则打印 "No task runs found."。

## 7. 与 Session Store 的分离

Task runs 和 sessions 分离，因为它们服务于不同目的：

| 关注点 | SessionStore | TaskStore |
| --- | --- | --- |
| 格式 | 每个 session 独立 JSONL 文件 | 单一扁平 JSONL 文件 |
| 查询 | 按 session ID | 按 task name、按 limit |
| 内容 | 完整对话 + trace | 任务摘要 + 状态 |
| 受众 | 开发者 / trace 检查 | 用户 / 任务监控 |

`TaskRunRecord` 包含 `sessionId`，以便在需要时始终可以从 `JsonlSessionStore` 检索完整 trace。

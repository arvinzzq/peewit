# 后台自动化

状态：草案
日期：2026-05-05

English version: [background-automation.md](./background-automation.md)

## 1. 目的

后台自动化让 ArvinClaw 在无前台用户连接的情况下运行 agent 任务。

本文档描述后台 adapter 概念、`BackgroundApprovalResolver`、task definition 格式、task run 生命周期以及迈向完整 daemon 的方向。

## 2. 后台 Adapter 概念

Adapter 将用户面向的界面连接到 Agent Core。后台任务是特殊情况："界面"是计划调用，而非人工交互。

后台 adapter：

- 接受 `TaskDefinition` 而非交互式用户输入。
- 以任务目标作为用户消息运行单个 agent turn。
- 收集所有 runtime events 并作为 trace 持久化。
- 返回退出码：成功为 0，失败为 1。

其 `AdapterCapabilities` 为 `BACKGROUND_CAPABILITIES`：

```ts
{ streaming: false, approvalPrompts: false, background: true }
```

后台 adapter 无法显示 streaming 输出或交互式审批提示，因为执行期间没有用户在场。

## 3. BackgroundApprovalResolver

`BackgroundApprovalResolver` 实现了 `@arvinclaw/core` 中的 `ApprovalResolver` 接口。

当 `AgentRuntime` 遇到需要用户确认的工具（`decision.decision === "ask"`）时，它会调用 resolver。后台 resolver 的行为取决于自主模式：

```
mode = "auto"     → 自动批准（approved: true）
mode = "confirm"  → 自动拒绝（approved: false）
mode = "observe"  → 自动拒绝（approved: false）
```

在 `auto` 模式下，agent 被信任可以在无用户干预的情况下只调用适当的工具。在 `confirm` 和 `observe` 模式下，没有用户可以咨询，因此 resolver 拒绝请求，run 安全失败。

这种设计使 `AgentRuntime` 不感知执行上下文。驱动交互式聊天的同一个 `AgentRuntime` 也驱动后台任务 — 只有 resolver 发生变化。

### 接口

```ts
class BackgroundApprovalResolver implements ApprovalResolver {
  constructor(mode?: "observe" | "confirm" | "auto")
  async resolve(request: ApprovalRequest): Promise<ApprovalResolution>
}
```

## 4. Task Definition 格式

`TaskDefinition` 是描述一个工作单元的纯数据对象：

```ts
interface TaskDefinition {
  name: string;          // 用于列表显示的人类可读名称
  goal: string;          // agent 的用户消息
  mode?: "observe" | "confirm" | "auto";  // 自主模式（默认：confirm）
  maxSteps?: number;     // 覆盖默认步骤限制
}
```

Phase 8 中，task definitions 作为 CLI 参数传递。未来扩展可从 YAML 或 JSON 文件加载。

## 5. Task Run 生命周期

每次 `arvinclaw run` 调用都遵循以下生命周期：

```
1. 加载配置并解析 sessions 目录。
2. 创建 JsonlSessionStore 用于 session/trace 持久化。
3. 创建 JsonlTaskStore 用于 task run 记录。
4. 生成 session ID 和 task run ID。
5. 保存初始 task run 记录（status: running）。
6. 构建 BackgroundApprovalResolver(mode)。
7. 使用 resolver 和 goal 构建 AgentRuntime。
8. 调用 runtime.runTurn({ message: goal }) 并收集 events。
9. 向 stdout 打印紧凑 trace。
10. 从 events 确定最终状态（completed vs failed）。
11. 用 status、assistantText、completedAt 更新 task run 记录。
12. 成功退出 0，失败退出 1。
```

步骤 2 的 session 文件使用现有 `JsonlSessionStore` 格式存储完整对话和 trace。步骤 5 的 task run 记录将任务特定元数据单独存储在 `task-runs.jsonl` 中。

## 6. Trace 持久化

后台任务产生与交互式聊天相同的 runtime events。Events 作为 trace 记录持久化到 session store。紧凑 trace 也在运行期间打印到 stdout，以便 CI 和 cron 日志捕获输出。

`task-runs.jsonl` 中的 task run 记录提供独立于完整 session trace 的轻量摘要视图：

```json
{"id":"run_abc","taskName":"test","goal":"do thing","sessionId":"session_xyz","startedAt":"...","status":"completed","assistantText":"Done!"}
```

## 7. Daemon 方向

Phase 8 实现一次性执行路径。未来 daemon 将：

1. 维护 task queue（JSONL 或 SQLite）。
2. 轮询或响应触发器（cron、文件监视、webhook）。
3. 从队列中拾取任务并调用相同的一次性执行逻辑。
4. 管理并发（例如，每个 workspace 每次一个任务）。
5. 暴露用于监控的健康检查 endpoint。

Phase 8 设计的一次性路径有意可组合，以便 daemon 包装器无需更改即可使用。

## 8. 安全原则

后台任务遵循与交互式聊天相同的 permission policy。

- Low-risk 工具无论模式如何都自动运行。
- Medium 和 high-risk 工具需要确认：在后台模式下 `confirm` 或 `observe` 意味着自动拒绝。
- Blocked 工具始终被拒绝。
- 在 `auto` 模式下，`BackgroundApprovalResolver` 批准 ask 级决策。

后台任务不应获得比 attended session 更多的权限。`auto` 模式是用户在定义任务时的显式选择。

# UI 适配器

状态：草稿
日期：2026-05-05

English version: [ui-adapters.md](./ui-adapters.md)

## 1. 目的

UI 适配器负责在用户界面与 Agent Core 之间进行翻译。

Peewit 有一个 Agent 运行时（`AgentRuntime`）和多个交互界面：终端、浏览器，以及未来的桌面端和消息端。适配器层让这些界面可以互换，而无需复制 Agent 逻辑。

核心规则：

Agent Core 负责行为。适配器负责交互。

## 2. 为何需要这一层

没有明确的适配器边界，每个界面往往会各自实现：

- 提示词组装
- 工具注册
- 权限策略
- 会话持久化
- 消息历史加载

最终结果是两套各自演化的独立 Agent。适配器模式通过强制所有行为走同一个 Core 来避免这种情况。

## 3. 适配器负责什么

适配器负责：

- 收集用户输入（终端 readline、HTTP POST、WebSocket 消息等）
- 渲染 Agent 输出（stdout、SSE 流、WebSocket 推送等）
- 渲染 Trace 事件（内联 Trace、结构化日志、Trace 面板）
- 呈现权限审批提示（readline 确认、Modal 遮罩、推送通知）
- 通过 `ApprovalResolver` 将审批决策转发给 Core
- 管理界面特定的生命周期（进程生命周期、HTTP 连接、桌面窗口）

适配器不得负责：

- 提示词或上下文组装
- 工具定义或工具执行逻辑
- 权限策略决策
- 会话或消息持久化规则
- 模型 Provider 配置

## 4. Core 向适配器提供什么

`AgentRuntime` 是适配器与 Agent 之间的唯一接口：

```ts
for await (const event of runtime.runTurn({ sessionId, recentMessages, message })) {
  // 适配器渲染每个事件
}
```

Core 发出类型化的 `RuntimeEvent` 值流。适配器消费该流并渲染到各自的界面。

适配器关注的事件类型：

| 事件 | 适配器操作 |
| --- | --- |
| `run_started` | 显示思考中指示器 |
| `token_delta` | 将文本追加到当前流式消息 |
| `tool_started` | 显示工具名称和 Spinner |
| `tool_completed` | 隐藏 Spinner，显示结果摘要 |
| `tool_failed` | 显示错误摘要 |
| `approval_requested` | 显示审批提示，暂停显示 |
| `approval_resolved` | 隐藏提示，恢复显示 |
| `todos_updated` | 更新任务进度面板 |
| `planning_stall_detected` | 显示停滞警告 |
| `assistant_message_created` | 显示最终消息文本 |
| `run_completed` | 结束本轮，显示用量 |
| `run_failed` | 显示错误，允许重试 |

## 5. ApprovalResolver：适配器与 Core 的接口

当工具操作需要用户审批时，Core 调用 `ApprovalResolver.resolve()` 并挂起等待决策。这是适配器在对话轮次执行期间唯一需要向 Core 回传信息的节点。

```ts
export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<ApprovalDecision>;
}
```

每个适配器有不同的实现：

- **CLI 适配器（readline）**：将提示写入 stdout，等待 readline 输入。
- **CLI 适配器（Ink）**：渲染 `<ApprovalPrompt>` 组件，等待按键。
- **Web 适配器**：向浏览器发送 `approval_requested` SSE 事件，在待决 Promise 上挂起，当浏览器 POST 审批决策时解析。
- **后台适配器**：遵循配置的自动批准或自动拒绝规则。

`ApprovalResolver` 在构建时注入 `AgentRuntime`。Core 不知道是哪个界面在解析审批。

## 6. 会话与 Trace 适配器

会话存储和 Trace 存储是注入的，而非硬编码的：

- CLI：`JsonlSessionStore`，存储于 `~/.peewit/sessions`。
- Web：初始使用 `InMemorySessionStore`；可升级为 `JsonlSessionStore` 或数据库。
- 测试：使用可控会话 ID 的 `InMemorySessionStore`。

`SessionStore` 和 `RuntimeTraceStore` 接口分别定义在 `@peewit/sessions` 和 `@peewit/core` 中。适配器在启动时选择具体实现。

## 7. 流式数据的适配器处理

当 Provider 实现了 `StreamingModelProvider` 时，运行时会发出 `token_delta` 事件。不同适配器的处理方式：

- **CLI（Ink）**：将增量数据送入 `<StreamingText>` 组件，就地重新渲染当前消息。
- **Web**：将每个 `token_delta` 事件以 SSE `data:` 行写入开放的事件流。
- **非流式 CLI（测试）**：忽略 `token_delta`，等待 `assistant_message_created`，后者始终携带完整内容。

不支持流式的适配器可以忽略 `token_delta`，等待 `assistant_message_created`——该事件始终包含完整内容。

## 8. CLI 适配器

CLI 适配器位于 `apps/cli`。

渲染路径（Phase 6+）：

```text
main()
  └─ Ink App 组件
       ├─ 从 CliChatSession.sendMessage() 读取事件
       ├─ 通过 <StreamingText> 渲染流式文本
       ├─ 通过 <ToolProgress> 显示工具进度
       ├─ 通过 <ApprovalPrompt> 显示审批提示
       └─ 通过 <TodosPanel> 显示任务列表
```

测试边界：

```text
CliChatSession.sendMessage()
  └─ 返回 CliChatTurnResult { assistantText, approvalLines, todosLines, events }
```

`CliChatSession` 层可注入，不导入 Ink。测试直接调用它。

## 9. Web 适配器

Web 适配器位于 `apps/web`。

```text
HTTP 客户端（浏览器）
  └─ POST /api/sessions/:id/turns
       └─ Hono 处理器
            ├─ 创建 SSE 响应流
            ├─ 运行 AgentRuntime.runTurn()
            ├─ 将每个 RuntimeEvent 写为 SSE data 行
            └─ 在 approval_requested 期间保持连接
```

审批流程：

```text
浏览器收到 approval_requested SSE 事件
  └─ 渲染 <ApprovalModal>
       └─ POST /api/sessions/:id/approvals
            └─ 服务端解析审批 Promise
                 └─ 对话轮次恢复，SSE 继续
```

## 10. 适配器对比

| 关注点 | CLI（Ink） | Web（Hono + React） |
| --- | --- | --- |
| 用户输入 | 终端 readline / 按键事件 | HTTP POST 请求体 |
| 流式输出 | Ink `<StreamingText>` 重渲染 | SSE `data:` 事件 |
| 审批提示 | `<ApprovalPrompt>` 组件 | `<ApprovalModal>` + POST |
| 会话存储 | `JsonlSessionStore` | `InMemorySessionStore` |
| 工具进度 | `<ToolProgress>` Spinner | SSE 事件 → React 状态 |
| 任务显示 | `<TodosPanel>` 组件 | SSE 事件 → React 状态 |
| 进程生命周期 | Node.js 进程 | Hono 服务器进程 |

## 11. 未来适配器

同样的模式支持：

- **桌面应用**：Electron 或 Tauri 适配器；原生文件对话框用于审批。
- **消息适配器**：Slack 或 Telegram Bot；通过回复按钮进行审批。
- **后台适配器**：无 UI；按配置策略自动批准/拒绝；结构化日志输出。
- **CI 适配器**：单轮 `run` 命令；无交互审批；拒绝时退出码非零。

每个新适配器只需实现 `ApprovalResolver`、选择 `SessionStore`，并消费 `RuntimeEvent` 流。无需修改 Agent Core。

## 12. 验收标准

- CLI 和 Web UI 共享同一个 `AgentRuntime`、`SessionStore` 和事件类型。
- 任何 Agent 逻辑（上下文组装、工具执行、权限策略）均不驻留在适配器中。
- 添加新适配器只需修改 `apps/` 和应用配置，无需修改 packages。
- `ApprovalResolver` 是适配器在对话轮次执行期间向 Core 反馈的唯一路径。

## 13. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [CLI 适配器](./cli-adapter.zh-CN.md)
- [Trace 可视化](./trace-visualization.zh-CN.md)
- [权限系统](./permission-system.zh-CN.md)
- [会话存储](./session-storage.zh-CN.md)
- [Phase 6 计划](../plans/phase-6-streaming-and-web-ui.zh-CN.md)

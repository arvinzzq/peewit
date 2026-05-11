# Trace 可视化

状态：草稿
日期：2026-05-11

English version: [trace-visualization.md](./trace-visualization.md)

## 1. 目的

Trace 是 Agent 做了什么、为何这样做以及结果如何的结构化记录。

Trace 可视化将这些记录转化为人类可读的形式——既可在执行过程中实时查看，也可在会话结束后回溯查阅。

两个目标：
- **学习**：让用户理解 Agent 是如何做出决策、调用工具以及组织回答的。
- **调试**：让开发者和用户理解失败原因、意外工具调用以及审批决策。

## 2. 什么会被记录

每个 `RuntimeEvent` 都是一条 Trace 记录。事件类型及其语义含义：

| 事件 | 含义 |
| --- | --- |
| `run_started` | 用户消息到达；Agent 开始本轮对话 |
| `context_assembled` | 系统提示词和消息历史已组装完成 |
| `model_request_started` | Agent 向模型发送了请求 |
| `token_delta` | 流式模型返回了单个文本 Token |
| `model_request_completed` | 模型返回了最终响应或工具调用批次 |
| `tool_call_requested` | 模型请求了特定工具调用 |
| `tool_call_permission_evaluated` | 权限策略评估了工具调用 |
| `approval_requested` | 工具调用需要用户审批；对话轮次挂起 |
| `approval_resolved` | 用户批准或拒绝了工具调用 |
| `tool_started` | 工具开始执行 |
| `tool_completed` | 工具返回了结果 |
| `tool_failed` | 工具返回了错误 |
| `todos_updated` | 模型更新了任务列表 |
| `planning_stall_detected` | 检测到纯规划轮次；注入了重试指令 |
| `assistant_message_created` | 产生了最终文本消息 |
| `run_completed` | 本轮对话成功结束 |
| `run_failed` | 本轮对话因错误结束 |

`token_delta` 事件是高频的纯显示事件，默认不存储到 Trace 历史中；只有最终的 `assistant_message_created` 会被存储。

## 3. Trace 存储

Trace 事件通过 `appendTraceEvent()` 按会话存储在 `SessionStore` 中。

存储的事件可以通过 `listTraceEvents()` 在会话结束后或会话之间回放。

测试中默认的 Trace 存储是 `InMemoryRuntimeTraceStore`。在生产 CLI 中，Trace 事件与消息一起追加到 JSONL 会话文件中。

`token_delta` 事件有意不存储——它们会以无意义的数量主导 Trace 文件。累积的文本内容可从 `assistant_message_created` 获取。

## 4. CLI Trace 渲染

### 紧凑模式（默认，实时）

执行期间，CLI 实时渲染紧凑的单行 Trace：

```
1. Received user message (run_started)
2. Assembled context (context_assembled)
3. Started model request (model_request_started)
   [流式文本在此显示]
4. Completed model request (model_request_completed)
5. Requested tool call (tool_call_requested)
6. Evaluated tool permission (tool_call_permission_evaluated)
7. Approval required: write_file [risk: medium]
   Approve once? [y/N/details]
8. Resolved approval (approval_resolved)
9. Started tool (tool_started)
10. Completed tool (tool_completed)
11. Created assistant message (assistant_message_created)
12. Completed run (run_completed)
```

### `/trace` 斜杠命令

随时显示当前会话的存储 Trace：

```
Recent Trace:
1. Received user message (run_started)
...
```

### 详细 Trace（debug 详细度）

当 `trace.verbosity` 为 `debug` 时，包含工具输入/输出摘要和原始 Provider 元数据。

### 基于 Ink 的实时 Trace（Phase 6）

使用 Ink 后，Trace 面板就地更新而非逐行追加。折叠的 Trace 摘要可展开查看。

## 5. Web UI Trace 渲染

在 Web UI 中，Trace 事件以 SSE data 行到达。React 前端在每个事件到达时更新 `<TracePanel>` 组件。

MVP Web Trace 面板：
- 可折叠的事件列表，按工具调用序列分组。
- 工具调用显示名称和风险级别。
- 审批事件显示决策结果。
- 最终消息显示在主聊天视图中。

Phase 7+ 可添加更丰富的 Trace 可视化：时序条、Token 用量图表、权限决策树。

## 6. 流式 Token 显示

`token_delta` 事件是纯显示事件，不存储。它们实时驱动流式文本的实时显示。

**CLI（Ink）**：`<StreamingText>` 累积 Token 并就地重新渲染文本。最后一个字符后显示闪烁光标。当 `assistant_message_created` 到达时，流式状态被最终确定的文本替换。

**Web UI**：SSE 客户端将每个 `token_delta.delta` 追加到 React 状态中的本地字符串缓冲区。`<StreamingMessage>` 组件在每次增量后重新渲染。`assistant_message_created` 用权威的最终内容替换缓冲区。

**非流式 CLI（测试）**：不发出 `token_delta` 事件。`assistant_message_created` 是唯一的消息事件。

## 7. Trace 与会话历史的区别

| 存储 | 内容 | 用途 |
| --- | --- | --- |
| 会话消息 | `role: user/assistant` + `content` | 上下文窗口重建 |
| Trace 事件 | 完整的 `RuntimeEvent` 流 | 学习、调试、审计 |

会话消息在恢复会话时进入上下文组装。Trace 事件仅供人类查阅，不回传给模型。

## 8. 审批 Trace

审批事件始终可见于 Trace。Trace 显示：

- 请求了哪个工具调用。
- 权限策略的决策（风险、原因）。
- 用户是否批准或拒绝。
- 审批原因。

这使权限决策在事后可审计。

## 9. 错误渲染

`run_failed` 包含原因字符串。适配器以显著方式渲染：

- CLI：以红色打印 `Error: <reason>`（或 Ink 中的样式块）。
- Web UI：在聊天视图中显示错误横幅。

工具失败（`tool_failed`）危害较小——模型通常可以通过尝试不同方式恢复。适配器显示紧凑的警告而不中断对话轮次。

## 10. 验收标准

- 每次执行均产生存储在会话文件中的完整 Trace。
- CLI `/trace` 命令显示当前会话的存储 Trace 事件。
- 实时 CLI Trace 以紧凑单行格式渲染。
- `token_delta` 事件不存储到 Trace 历史中。
- Web UI 在可折叠面板中显示 Trace 事件。
- 审批决策始终可见于 Trace。
- 会话结束后可从会话存储回放 Trace。

## 11. 相关文档

- [执行 Trace](./execution-trace.zh-CN.md)
- [UI 适配器](./ui-adapters.zh-CN.md)
- [CLI 适配器](./cli-adapter.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [会话存储](./session-storage.zh-CN.md)
- [Phase 6 计划](../plans/phase-6-streaming-and-web-ui.zh-CN.md)

# Execution Trace

状态：草案
日期：2026-05-02

English version: [execution-trace.md](./execution-trace.md)

## 1. 目的

Execution trace 是 Agent 在任务期间做了什么的可见记录。

ArvinClaw 应该既是有用的产品，也是学习项目。Trace 是连接这两个目标的桥梁：它让用户理解 Agent 如何解释目标、选择工具、处理权限、观察结果并得出答案。

核心规则：

Trace 解释执行。它绝不能暴露隐藏模型推理。

## 2. 为什么这个模块存在

没有 trace，Agent 会像黑盒。用户可能看到最终答案，但不知道发生了什么、工具是否安全使用，或 Agent 为什么停止。

Execution trace 给 ArvinClaw 提供：

- 用户信任
- 可调试性
- 学习可见性
- 权限审计历史
- 工具执行历史
- 未来 Web UI 可视化的基础

## 3. Trace Levels

ArvinClaw 应支持多个 trace levels。

| Level | 用途 | 内容 |
| --- | --- | --- |
| Concise | 快速产品使用 | 工具名称、短结果、最终答案 |
| Explainable | MVP 默认模式 | 目标理解、计划、工具选择原因、权限决策、输入/输出摘要、下一步 |
| Debug | 开发 | 原始 provider messages、原始工具参数、耗时、可用时的 token usage |

MVP 应默认使用 Explainable。

Debug trace 可能包含敏感或嘈杂信息，所以不应是默认用户体验。

## 4. Trace 应该展示什么

默认 explainable trace 应展示：

- 收到的用户目标
- Agent 如何理解目标
- 是否创建或更新了计划
- 选择了哪个工具
- 为什么选择该工具
- 做出了什么权限决策
- 是否请求用户批准
- 工具输入的安全摘要
- 工具输出的安全摘要
- Agent 下一步会做什么
- 最终结果
- 任何错误或取消

Trace 应足够详细，便于学习，但不能详细到让正常使用变得痛苦。

## 5. Trace 绝不能展示什么

Trace 不能包含：

- 隐藏 chain-of-thought
- 原始 secrets
- Secret-like files 的完整内容
- 未脱敏 API keys
- 无边界命令输出
- 大型原始文件内容，除非用户明确请求且安全
- 默认情况下的敏感 provider metadata

Trace 应总结有风险或很大的内容，并尽量保留 references。

## 6. Trace Events

实现计划阶段会细化具体 event types，但 MVP trace events 可以包括：

- `user_message_received`
- `context_built`
- `model_response_received`
- `plan_created`
- `plan_updated`
- `tool_selected`
- `tool_call_permission_evaluated`
- `approval_requested`
- `approval_resolved`
- `tool_started`
- `tool_completed`
- `tool_failed`
- `observation_recorded`
- `final_response`
- `task_cancelled`
- `task_failed`

Events 应是结构化数据，而不只是格式化文本。这样 CLI、Web UI 和未来日志可以用不同方式渲染同一 trace。

## 7. Event Shape

Trace event 应包含：

- Event ID
- Timestamp
- Event type
- Short title
- Human-readable summary
- Optional structured details
- Related tool call ID, if any
- Related permission decision ID, if any
- Visibility level
- Redaction status when relevant

说明性结构：

```ts
interface TraceEvent {
  id: string;
  timestamp: string;
  type: TraceEventType;
  title: string;
  summary: string;
  details?: unknown;
  visibility: "concise" | "explainable" | "debug";
  redacted?: boolean;
}
```

## 8. Tool Trace

Tool-related trace 应记录：

- Tool name
- Tool purpose summary
- Safe input summary
- Permission decision
- Start time
- End time
- Success or failure
- Safe output summary
- 相关 source path 或 URL

Tool trace 应避免把大型原始输出直接塞进模型上下文或 CLI 展示。Trace store 可以保留结构化 metadata，而模型只接收更小的 observation。

## 9. Permission Trace

Permission trace 应记录：

- 被评估的 action
- Risk level
- Decision type：allow、ask 或 deny
- Decision reason
- 是否请求用户批准
- 批准是 granted 还是 denied

Permission trace 很重要，因为它解释 Agent 为什么可以或不可以继续。

## 10. Error Trace

Failures 应可追踪。

Error trace 应包含：

- 什么失败了
- 在哪里失败
- 失败是否可恢复
- Agent 接下来做了什么
- 用户是否需要采取行动

Errors 应足够归一化，让用户在正常使用时看到清晰信息，而不是原始 stack traces。

## 11. Trace Storage

MVP trace storage 可以是本地且简单的。

Trace records 最终应关联：

- Session ID
- Task ID
- User turn ID
- Tool call ID
- Timestamp

Phase 5 会把 runtime trace events 持久化到与 session messages 相同的 JSONL file 中。这样 trace replay 保持本地、append-only 且容易检查，同时仍为后续更丰富的 trace index 留空间。

## 12. CLI Rendering

CLI 应以可读方式渲染 trace。

MVP 行为：

- 在 `chat` 期间 inline 展示重要 trace events。
- 提供 `/trace` 展示最近 trace details。
- 对 named sessions，CLI process 重启后 `/trace` 应加载持久化的 current-session trace。
- 默认隐藏 debug-only details。
- 清晰标记 permission prompts 和 tool results。

CLI renderer 应消费结构化 trace events，而不是从原始 logs 反推行为。

## 13. Web UI Evolution

Web UI 后续可以使用同一批 trace events 展示：

- Timeline view
- Tool call panels
- Permission approval cards
- Plan progress
- Error details
- Source links

这就是 trace events 应该从一开始就结构化的原因。

## 14. Redaction

Trace 需要 redaction rules。

MVP 应脱敏：

- API keys
- Environment secrets
- Secret-like file contents
- Large command outputs
- Known credential patterns

在可行时，redaction 应在 trace 展示或持久化之前发生。

## 15. 测试要求

Execution trace 需要测试，因为它是用户观察 Agent 行为的主要窗口。

必需测试领域：

- Model responses 的 trace event creation
- Tool calls 的 trace event creation
- Permission decisions 的 trace event creation
- Secrets 和 large outputs 的 redaction
- Explainable trace 的 CLI rendering
- Debug details 默认隐藏
- Error trace behavior
- 增加 persistence 后的 session association
- Current-session trace 的 persistence 和 replay
- 每个新增 trace event type 的回归测试

任何改变 Agent Loop、Tool System、Permission System、CLI rendering 或 session persistence 的迭代，都应更新 trace tests。

## 16. 验收标准

MVP Execution Trace 成功标准：

- 每个 user turn 都产生 trace events。
- Tool calls 在 trace 中可见。
- Permission decisions 在 trace 中可见。
- Errors 在 trace 中可见。
- Secret-like content 被脱敏。
- CLI 可以展示最近 trace details。
- CLI 可以为 named session replay 持久化 trace details。
- Trace data 足够结构化，可用于未来 Web UI rendering。
- Trace behavior 被 unit 和 integration tests 覆盖。

## 17. 相关文档

- [主设计](../product/arvinclaw-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)
- [CLI Adapter](./cli-adapter.zh-CN.md)

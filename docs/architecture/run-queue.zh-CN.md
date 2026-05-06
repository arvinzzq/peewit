# Run Queue

状态：草案
日期：2026-05-02

English version: [run-queue.md](./run-queue.md)

## 1. 目的

Run queue 控制 Peewit 如何接受、排序、执行和持久化 agent runs。

OpenClaw 调研显示，runs 会按 session 序列化，并通过 queues 和 session write locks 协调。Peewit 应分阶段采用这个架构。

核心规则：

一个 session 不应有多个不受控制的 agent runs 同时写入同一段 history。

## 2. 为什么这个模块存在

没有 run queue 语义时，多个用户消息、后台任务或未来 channel events 可能触发重叠 agent runs。

这会造成风险：

- Conversation history 可能乱序写入。
- Tool observations 可能附到错误 turn。
- Permission prompts 可能变得混乱。
- Trace events 可能错误交错。
- Background automation 可能与用户驱动的 chat 竞争。

Run queue 给 Peewit 提供可预测执行和持久化行为。

## 3. MVP 范围

MVP 不需要复杂 distributed queue。

MVP 应包含：

- Explicit run IDs
- 每个 CLI session 一个 active run
- In-memory run state
- Safe cancellation path
- Ordered session writes
- 绑定 run ID 的 trace events

MVP 可以延后：

- Persistent queue
- Cross-process coordination
- Background run scheduling
- Multi-agent routing
- Remote node execution
- Run retry policy

## 4. Run Identity

每个 agent run 都应有 run ID。

Run ID 让系统可以连接：

- User message
- Agent response
- Tool calls
- Permission decisions
- Trace events
- Session writes
- Errors or cancellation

Run ID 应出现在 trace metadata 和 session records 中。

## 5. Session Serialization

Peewit 最终应按 session 序列化 runs。

规则：

同一时间只有一个 run 应主动 mutate 一个 session。

如果同一 session 请求第二个 run，系统可以：

- Reject it
- Queue it
- 询问用户是否取消 active run
- 在未来 phases 中把它当作 steering message

MVP 可以从在同一 CLI process 内拒绝 overlapping runs 开始。

## 6. Global Queue

未来 global queue 可以限制跨 sessions 的总并发工作。

当 Peewit 支持以下能力时，这会很重要：

- Multiple sessions
- Web UI
- Background automation
- Messaging channels
- Multi-agent routing

MVP 可以延后 global queue，但 run model 应为它留空间。

## 7. Session Write Lock

Session write locks 保护 session history 和 trace persistence。

Lock 应确保：

- Messages 按顺序追加。
- Tool observations 附到正确 run。
- Trace events 在一个 session 内保持顺序。
- Compaction 或 memory flush 不与普通 writes 竞争。

MVP 可以使用简单 single-process ordering。后续 phases 可以在 session storage layer 实现显式 locks。

## 8. Run States

Run state 应是显式的。

建议 states：

- `queued`
- `running`
- `waiting_for_approval`
- `cancelling`
- `completed`
- `failed`
- `cancelled`

CLI 和未来 Web UI 可以使用这些 states 展示用户可见进度。

## 9. Cancellation

Runs 需要 cancellation path。

MVP cancellation 应：

- 在可行时停止后续 model/tool steps
- 将 run 标记为 cancelled
- 持久化 trace event
- 让 session history 保持一致状态

MVP 中 tool cancellation 可以是 best-effort。

## 10. Approval Waiting

当 permission decision 需要用户批准时，run 进入 `waiting_for_approval`。

Run 应保存：

- Tool action
- Risk classification
- Approval prompt
- Timeout behavior, if any
- User approval or denial

未来 adapters 可以异步处理 approval。

## 11. Steering Messages

OpenClaw-like systems 可能支持 active run 期间的 steering messages。

Peewit 应延后 steering messages。

未来行为可以允许：

- User interrupts
- Additional instructions
- Run cancellation
- Priority updates

这不应在 run state、trace 和 session writes 稳定前实现。

## 12. 与 Session Storage 的关系

Run queue 控制执行顺序。

Session storage 持久化结果。

Session storage 不应决定 scheduling。Run queue 不应拥有 durable transcript schema。

边界：

- Run queue：什么现在运行、等待或停止
- Session storage：什么被写入和加载

## 13. 与 Execution Trace 的关系

每个 run state transition 都应产生 trace events。

Trace 应包括：

- Run accepted
- Run started
- Run waiting for approval
- Run resumed
- Run completed
- Run failed
- Run cancelled

这让 queue behavior 对用户可见。

## 14. 与 Background Automation 的关系

Background automation 依赖 run queue 语义。

在实现 scheduled tasks 或 heartbeat behavior 前，Peewit 需要：

- Run IDs
- Run states
- Session serialization
- Approval waiting
- Cancellation
- Trace persistence

## 15. 测试要求

Run queue behavior 需要测试，因为 concurrency bugs 很难调试。

必需测试领域：

- Run ID creation
- 每个 session 一个 active run
- Ordered session writes
- Run state transitions
- Permission approval waiting state
- Cancellation behavior
- Run lifecycle 的 trace events
- Rejection or queuing of overlapping same-session runs
- Future global concurrency limits
- Future background run interactions

任何改变 session storage、execution trace、permissions、background automation 或 adapters 的迭代，都应更新 run queue tests。

## 16. 验收标准

MVP run queue design 成功标准：

- 每个 run 都有 run ID。
- 一个 CLI session 最多一个 active run。
- Run state 是显式的。
- Session writes 有顺序。
- Permission approval 可以暂停 run。
- Cancellation 后 trace 和 session data 保持一致。
- Run lifecycle events 出现在 trace 中。
- Behavior 被 unit 和 integration tests 覆盖。

## 17. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [主设计](../product/peewit-design.zh-CN.md)

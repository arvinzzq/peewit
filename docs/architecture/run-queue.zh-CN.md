# Run Queue

状态：活跃（Phase 0–10 通过 SessionMutex 交付；Phase 11 以 lane 替换）
日期：2026-05-11

English version: [run-queue.md](./run-queue.md)

## 1. 目的

Run queue 控制 Vole 如何接受、排序、执行和持久化 agent runs。

OpenClaw 调研显示，runs 会按 session 序列化，并通过 queues 和 session write locks 协调。Vole 分阶段采用这个架构：Phase 10 之前用单进程 `SessionMutex`，Phase 11 起改为真正的三层 lane 系统（见 [Lanes](./lanes.zh-CN.md) 与 [Gateway](./gateway.zh-CN.md)）。

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

Run queue 给 Vole 提供可预测执行和持久化行为。

## 3. 分阶段范围

Phase 0–10 交付了单进程 MVP，包含：

- 显式 run ID
- 每个 CLI session 一个 active run（由 `SessionMutex` 强制）
- 进程内 run state
- 安全的 cancellation 路径
- 有序的 session 写入
- 绑定 run ID 的 trace events
- 通过 `vole daemon` 的后台 run 调度（Phase 8）

Phase 11 在此之上扩展：

- 三层 lane 准入（global / subagent / session）—— 见 [Lanes](./lanes.zh-CN.md)
- session JSONL 写入周围的跨进程文件锁
- 结构化 session key（`agent:<id>:<lane-type>:<uuid>`）
- gateway 中介的 submit / cancel / subscribe —— 见 [Gateway](./gateway.zh-CN.md)

仍延后到后续 phase：

- 持久化 / 磁盘后端 queue（Phase 14 SQLite TaskFlow 处理跨 session 持久化）
- 远程节点执行（Phase 17+）
- Queue 层面的 run 重试策略
- Steering 消息（Phase 12 引入 `subagents steer`；面向用户的 steering 更晚）

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

Vole 按 session 序列化 runs。

规则：

同一时间只有一个 run 应主动 mutate 一个 session。

Phase 10 之前由 `packages/sessions` 中的 `SessionMutex` 强制。Phase 11 将 mutex 替换为并发固定为 1 的 session lane；lane 是 mutex 的严格泛化。用户可见行为相同：同一 session 的第二次提交等待第一个完成（排队，不拒绝）。

如果同一 session 请求第二个 run，系统在 session lane 上排队。未来 phase 可能加入 steering 路径，让活跃 run 吸收新指令而非排队等待。

## 6. Global Queue

Phase 11 引入 global lane（默认并发 16），加上一个专门的 subagent lane（默认并发 8）。每个 run 都穿过 global lane；子代理触发的 run 也穿过 subagent lane。

这限定了跨以下场景的总并发工作：

- 多个 session
- CLI 与 Web 并行运行
- 后台自动化
- 子代理 spawn
- 未来的消息 channel

配置位于 `gateway.lanes.*`。默认值对齐 OpenClaw 文档的限值，可以按 workspace 调整。

## 7. Session Write Lock

Session write locks 保护 session history 和 trace persistence。

Lock 确保：

- Messages 按顺序追加。
- Tool observations 附到正确 run。
- Trace events 在一个 session 内保持顺序。
- Compaction 或 memory flush 不与普通 writes 竞争。

Phase 0–10 依赖 `SessionMutex` 做进程内排序。Phase 11 在其上叠加进程感知的文件锁：session lane 在一个 Node 进程内排序写入，`.lock` 旁车文件（含 PID + 启动时间，60 秒 acquire 超时）阻止第二个 `vole` 进程交错写入同一 session JSONL。陈旧锁（PID 已死）被自动回收。

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

Vole 应延后 steering messages。

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

在实现 scheduled tasks 或 heartbeat behavior 前，Vole 需要：

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
- [主设计](../product/vole-design.zh-CN.md)

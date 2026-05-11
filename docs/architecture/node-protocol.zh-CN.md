# Node Protocol

状态：Phase 10 基础
日期：2026-05-11

English version: [node-protocol.md](./node-protocol.md)

## 1. 目的

本文档描述 Vole 向多节点 agent 架构的未来方向，并建立使该方向成为可能的 Phase 10 基础。

## 2. 未来多节点方向

节点是指可以托管一个或多个 `AgentRuntime` 实例并与其他节点通信的任何进程或设备。在成熟的多节点 Vole 中：

- 桌面节点可能托管主要个人 agent。
- 服务器节点可能托管长时间运行的后台任务。
- 移动节点可能托管轻量级只读助手。
- 节点通过共享协议通信：session events、tool results、approval requests 和 heartbeats。

这是 OpenClaw 架构所指向的方向。Vole 将逐步接近这个目标。

## 3. Phase 10 基础：单进程 Sub-Agents

Phase 10 不实现真正的多节点协议。相反，它建立基础：

- Sub-agents 使用相同的 `AgentRuntime` 类在进程内运行。
- `SubagentFactory` interface 赋予 adapters 控制 sub-runtimes 创建方式的能力。
- `SessionGateway` 追踪哪些 sessions 是活跃的，以及哪个 adapter 拥有它们。

这些原语是多节点协议所需内容的进程内等价物：session 身份、runtime 创建和生命周期追踪。

## 4. Phase 10+ 的协议形态

当 Vole 在未来阶段添加真正的节点协议时，预期的消息类型是：

- `session.register` — 节点宣布新的 session 及其 capabilities。
- `session.heartbeat` — 节点确认 session 仍然活跃。
- `session.unregister` — 节点宣布 session 已结束。
- `event.forward` — 节点将 runtime event 转发给感兴趣的各方。
- `tool.request` — runtime 向另一个节点请求 tool 执行。
- `tool.result` — 节点返回 tool 执行结果。
- `approval.request` — runtime 向有能力的 adapter 请求用户审批。
- `approval.response` — adapter 返回审批决定。

Phase 10 中的 `SessionGateway` 在本地处理 session 生命周期消息。在未来的阶段，gateway 将通过网络传输接收这些消息，而不是进程内调用。

## 5. 设计约束

为保持 Phase 10+ 升级路径开放：

- 不要在 `SessionGateway` 中编码传输特定的假设；它应该是可包装的。
- 不要在 adapters 中硬编码 approval 路由；通过 `ApprovalResolver` 路由。
- `GatewaySession` 字段应与网络注册消息携带的字段匹配。

## 6. 参考

- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md) — sub-agent 概念和 factory interface
- [Gateway](./gateway.zh-CN.md) — session 注册表和 Phase 10 实现
- [OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md) — OpenClaw 确认的节点协议方向

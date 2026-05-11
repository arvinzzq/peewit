# Gateway

状态：活跃（Phase 10 基础，Phase 11 扩展计划中）
日期：2026-05-11

English version: [gateway.md](./gateway.md)

## 1. 目的

Gateway 是位于 adapter 与 agent runtime 之间的路由与协调层。从 Phase 11 起，它也是每个 agent run 的唯一受理点：CLI、Web、scheduler、子代理与未来的 channel 都通过它提交工作。

本文档同时描述 Phase 10 基础（session 注册表）与 Phase 11 扩展（带 submit / subscribe / cancel 与三层 lane 准入的 `GatewayCore`）。

## 2. 为什么需要 Gateway

单 `AgentRuntime` 在一个进程一个 session 时表现良好。随着 Vole 演进为个人代理平台，多种问题浮现：

- 多个 adapter（CLI、Web、桌面、后台）需要访问相同的 agent session。
- 多个 agent runtime 可能并发运行 —— 每 workspace 一个、每上下文一个、后台任务。
- 一些能力是 adapter 专属：后台任务无法弹出审批模态。
- 并发必须有界：无上限的子代理 spawn 或并行写入会损坏状态。
- Cancel 需要一个知道该中断哪条 lane 的唯一权威点。

Gateway 在 adapter 之上引入路由与准入层解决这些问题。

## 3. GatewayCore API（Phase 11）

Phase 11 把 `SessionGateway` 扩展为 `GatewayCore`，每个 adapter 必须通过它提交：

```ts
interface GatewayCore {
  submit(req: RunRequest): AsyncIterable<RuntimeEvent>;
  subscribe(sessionKey: string): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  status(): GatewayStatus;

  register(session: GatewaySession): void;
  unregister(sessionKey: string): void;
  touch(sessionKey: string): void;
  get(sessionKey: string): GatewaySession | undefined;
  list(filter?: GatewayListFilter): GatewaySession[];
}
```

`submit` 解析目标 session、把 run 链式穿过适用的 lane（见 [Lanes](./lanes.zh-CN.md)）、并 yield runtime 事件。`subscribe` 接入一个已经在跑的 session 的事件流而不自己触发 run —— 对迟到加入的 Web UI 有用。`cancel` 按 id 中断特定 run；session lane 释放槽位，排队中的工作继续。

`register / unregister / touch / get / list` 保留 Phase 10 的 session 注册表表面。Session 记录携带 `sessionKey`、`agentId`、`adapterName`、`capabilities`、`registeredAt`、`lastActivityAt`。

## 4. Gateway 不是什么

Gateway 不是负载均衡或云服务。它是一个本地 Vole 实例的进程内协调层。它最终可能拥有远程传输（Phase 17+），但 Phase 11 让 gateway 完全进程内。

Gateway 不拥有 agent 行为。工具、权限、上下文装配与 model provider 仍在各自 package。Gateway 路由提交、应用 lane 准入、派发事件；它不改写模型输出，也不覆盖权限决策。

Gateway 也不拥有 session 存储。JSONL 与（Phase 14）SQLite store 在 `packages/sessions`。Gateway 在内存中持有 session *元数据*，需要 transcript 时通过 store 查询。

## 5. Phase 10 基础

Phase 10 交付了首个具体 `packages/gateway` package，其中 `SessionGateway` 作为内存 session 注册表：

- `register(session)` 在 session 激活时由 adapter 调用。
- `unregister(sessionKey)` 在 session 结束时调用。
- `touch(sessionKey)` 在每个活跃回合更新 `lastActivityAt`。
- `get / list / listByAdapter` 将注册表暴露给调用方。

CLI adapter 在 `CliChatSession.createConfigured()` 中注册 session，在 `close()` 中注销。Web adapter 在 `createWebSession()` 中注册 session。Web 服务器暴露 `GET /api/gateway/sessions` 供调用方检视注册表。

Phase 11 保留这些方法，并在其上增加 submit / subscribe / cancel 表面。

## 6. Phase 11 扩展

Phase 11 让 gateway 成为 `AgentRuntime.runTurn` 的唯一合法调用方：

- Adapter 不再构造 `AgentRuntime`，改为调用 `gateway.submit(req)`。
- 每次 submit 在 runtime 执行前依次穿过三层默认 lane —— global、subagent（适用时）、session。
- Session key 规范化为 `agent:<agentId>:<lane-type>:<uuid>`，把 agent 身份与父 / 子关系编码进 key 本身。
- Session JSONL 周围的跨进程文件锁在 session lane 闭包内获取和释放；跨进程调用方通过两层都串行化。
- `cancel(runId)` 把 abort signal 传播至活跃 `runTurn`；runtime 必须在安全检查点（下一次模型调用前、下一次工具调用前）兑现。
- `status()` 返回 lane 占用与活跃 run 的快照，供 `vole gateway status` 命令使用。

`AgentRuntime` 本身仍聚焦于 turn 循环并可独立测试。Runtime 接受可选的 abort signal 与一个 session-mutex 形状的锁；Phase 11 把它们连到 session lane 与文件锁。

## 7. 未来方向

Phase 12 在 subagent lane 之上叠加 per-parent child 计数器以执行 `maxChildrenPerAgent`。Phase 15 channel 通过同一个 gateway 提交，session key 加 `channel:` 前缀。Phase 16 doctor 检查检视 gateway 状态以查找陈旧 session 与孤儿锁。

远程传输直到 Phase 16 都明确不在范围内。如果未来某 phase 把 gateway 暴露为 HTTP / Unix socket，上述 API 形状的设计可一比一翻译到 RPC：每个方法变成一个 RPC 方法，`AsyncIterable<RuntimeEvent>` 变成 server-streaming 响应。

## 8. 参考

- [Lanes](./lanes.zh-CN.md) —— 准入与串行化原语
- [Run Queue](./run-queue.zh-CN.md) —— run 生命周期与状态机
- [Adapters](./adapters.zh-CN.md) —— adapter 边界与能力
- [Session Storage](./session-storage.zh-CN.md) —— session 持久化契约
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md) —— gateway 协调的子代理 spawn
- [OpenClaw 架构映射](./openclaw-architecture-map.zh-CN.md) —— OpenClaw 的 gateway 与 node 协议
- [Phase 11 计划](../plans/phase-11-gateway-and-lanes.zh-CN.md)

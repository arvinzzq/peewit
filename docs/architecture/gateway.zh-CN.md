# Gateway

状态：草案（计划中 — Phase 10）
日期：2026-05-05

English version: [gateway.md](./gateway.md)

## 1. 目的

Gateway 是多界面、多 agent 系统中位于 adapters 和 agent runtimes 之间的路由和协调层。

本文档描述 gateway 的预期角色，确保 Phase 7–9 的决策不会意外阻碍 Phase 10 的设计。

## 2. 为什么需要 Gateway

单个 `AgentRuntime` 在每个进程一个 session 时运行良好。随着 ArvinClaw 向个人 agent 平台演进，会出现几个问题：

- 多个 adapters（CLI、Web、桌面、后台）需要访问相同的 agent sessions。
- 多个 agent runtimes 可能并发运行 — 每个 workspace 一个、每个 context 一个、后台任务一个。
- 某些 capabilities 是 adapter 特有的：后台任务不能显示 approval modal。
- 路由必须处理 capability 不匹配：需要 approval 的 tool 必须到达能够提示的 adapter。

Gateway 通过在各个 adapters 之上引入路由层来解决这些问题。

## 3. Gateway 职责（Phase 10）

- **Session 注册表**：将 session ID 映射到活跃的 runtimes 及其 adapter 连接。
- **Adapter capability 路由**：将 approval requests、streaming 输出和后台任务路由到支持所需 capabilities 的 adapters。
- **Multi-agent 协调**：允许一个 runtime 将子任务交给另一个 runtime（sub-agent spawning）。
- **Event bus**：向 session 的所有连接 adapters 广播 runtime events。
- **生命周期管理**：管理 runtime 创建、暂停和清理。

## 4. Gateway 不是什么

Gateway 不是负载均衡器或云服务。它是个人 agent 的本地协调层。最终可能支持远程节点（Phase 10），但初始是进程内或设备内的。

Gateway 不拥有 agent 行为。Tools、permissions、context assembly 和 model providers 保留在各自的 packages 中。Gateway 路由 events；不转换它们。

## 5. 早期 Gateway 方向（Phase 7）

Phase 7 为 gateway 建立基础：

- `AdapterCapabilities` 使每个 adapter 的能力明确，gateway 后续可以用于路由。
- 共享的 `resolveSessionsDirectory` 意味着 CLI 和 Web 写入相同的 session 文件，使共享 session 注册表成为可能。
- Web server 的共享 `JsonlSessionStore` 证明多个界面可以共享持久状态。

Phase 8 将引入 background adapters，需要 capability-aware 路由（无 approval prompts、无 streaming 显示）。

Phase 10 将在这些基础上构建完整 gateway。

## 6. 设计约束

Phase 7–9 中任何会使 gateway 复杂化的变更都应避免：

- 不要在 `AgentRuntime` 中硬编码 adapter 特有行为。
- 不要将 session 存储与特定 adapter 耦合。
- 不要允许 adapters 绕过 `ApprovalResolver` — approval 路由是 gateway 关注点。
- 不要创建第二个 session 目录 — 两个 adapters 必须使用相同路径，使 gateway 能够统一 session 访问。

## 7. Phase 10 实现

Phase 10 将第一个具体的 gateway 实现作为 `packages/gateway` package 交付。

`SessionGateway` 类是一个简单的内存注册表：

- **`register(session: GatewaySession)`** — 当 session 变为活跃时由 adapter 调用。
- **`unregister(sessionId: string)`** — session 结束时调用。
- **`touch(sessionId: string)`** — 在每次活跃 turn 时更新 `lastActivityAt`。
- **`get(sessionId: string)`** — 如果存在则返回 session 记录。
- **`list()`** — 返回所有活跃 sessions。
- **`listByAdapter(adapterName: string)`** — 返回某一 adapter 界面的 sessions。

`GatewaySession` 记录包含：`id`、`adapterName`、`capabilities`（来自 `@arvinclaw/adapters`）、`registeredAt` 和 `lastActivityAt`。

CLI adapter 在 `CliChatSession.createConfigured()` 中注册 sessions，在 `close()` 中注销。Web adapter 在 `createWebSession()` 中注册 sessions。Web server 暴露 `GET /api/gateway/sessions`，调用方可以检查注册表。

## 8. 参考

- [Adapters](./adapters.zh-CN.md) — adapter 边界、capabilities 和当前界面
- [Session Storage](./session-storage.zh-CN.md) — session 持久化契约
- [OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md) — OpenClaw 的 gateway 和 node protocol
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md) — gateway 将协调的 sub-agent spawning

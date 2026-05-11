# Phase 11：Gateway 与 Lane 基础设施

状态：完成
日期：2026-05-11

English version: [phase-11-gateway-and-lanes.md](./phase-11-gateway-and-lanes.md)

## 进度

状态：完成

已完成提交：

- [x] Step 1：docs(arch) — `a8eec7f`
- [x] Step 2：feat(lanes) `packages/lanes`，含 `FifoLane`、`LaneRegistry`、`runThroughLanes` — `be672de`
- [x] Step 2.5：docs(learning) `16-lanes.md` + `13-gateway.md` 前瞻提示 — `847600e`
- [x] Step 3：feat(gateway) `GatewayCore` 含 `submit`、`cancel`、`status` — `84155e1`
- [x] Step 4：feat(sessions) 跨进程 `acquireSessionFileLock` + `JsonlSessionStore` 集成 — `6118d07`
- [x] Step 5a：refactor(cli) 聊天 run 通过 `GatewayCore.submit` 路由 — `621bdf9`
- [x] Step 5b：refactor(web) HTTP 与 WebSocket turn 通过 `GatewayCore.submit` 路由 — `664eff2`
- [x] Step 5c：refactor(core) 移除 `SessionMutex`；lane 准入成为唯一的进程内串行化 — `5cd723d`
- [x] Step 6：feat(cli) `vole gateway status` 命令 — `ad6b504`
- [x] Step 7：docs 标记 Phase 11 完成 + roadmap 更新 — （本次提交）

## 1. 目的

Phase 11 建立后续所有 phase 共同依赖的运行时基础：真正的 gateway 层、三层 lane 队列系统、规范化的 session key 命名，以及跨进程写锁。

Phase 0–10 让 CLI 与 Web adapter 直接接到 `AgentRuntime`，靠单一的进程内 `SessionMutex` 做串行化。这对单用户单 shell 够用，一旦出现多入口、子代理、定时任务争用同一 workspace 就会出问题。OpenClaw 把"per-session 与全局 lane 队列"当作底线假设；Vole 必须先把这块补齐，再去加入更多 agent、channel 或存储后端。

本 phase 以基础设施优先，本身不直接交付用户可感能力，但解锁 Phase 12（子代理成熟化）、Phase 14（SQLite 迁移）和 Phase 15（channels 与多 agent 身份）。

## 2. 范围

本 phase 包含：

- `packages/gateway`：将 `SessionGateway` 从会话注册表扩展为带 submit / subscribe / cancel 方法的 `GatewayCore`。
- `packages/lanes`：新 package，导出 `Lane`、`LaneRegistry` 以及三层默认 lane（global、subagent、session）。
- `packages/sessions`：用类 `proper-lockfile` 的工具为 session JSONL 写入加入跨进程文件锁。
- 将 `SessionMutex` 替换为 concurrency=1 的 session lane，并废弃单独的 mutex。
- 规范化 session key 格式为 `agent:<agentId>:<lane-type>:<uuid>`；在 key 中编码父子关系，为子代理工作做准备。
- CLI 检查命令：`vole gateway status` 打印 lane 占用与排队中 run。
- 更新架构文档 `gateway.md`、`run-queue.md`，并新增 `lanes.md`。

本 phase 不包含：

- gateway 的远程 RPC 暴露（不引入 HTTP / Unix socket 传输）。
- 多进程 gateway daemon。
- Channel 集成（Phase 15）。
- SQLite 迁移（Phase 14）。
- 子代理推送完成机制（Phase 12）。

## 3. 架构摘要

### GatewayCore

`GatewayCore` 是任何 run 的唯一入口。CLI 与 Web adapter 不再直接构造 `AgentRuntime`，而是调用 `gateway.submit(runRequest)`。Gateway 解析目标 session，将请求路由到合适的 lane，并返回事件流。

```ts
interface GatewayCore {
  submit(req: RunRequest): AsyncIterable<RuntimeEvent>;
  subscribe(sessionId: string): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  status(): GatewayStatus;
}
```

现有的 `SessionGateway` 注册表并入 `GatewayCore` 作为其 session 元数据存储。不引入远程 RPC。

### LaneRegistry

`Lane` 是一个带可配置并发上限的 FIFO 队列。提交的工作在达到上限时排队，槽位空出再运行。

三层默认 lane：

| Lane | 默认并发 | 范围 |
| --- | --- | --- |
| `global` | 16 | 所有工作，无视 session |
| `subagent` | 8 | 仅子代理派生的 run |
| `session:<sessionId>` | 1 | 单 session 严格串行 |

一个 run 必须通过所有适用的 lane（全局闸门、可能的 subagent 闸门，以及唯一一个 session lane）。Per-session 并发 1 完全复现现有的 `SessionMutex` 语义，行为不变。

### Session Key 命名

Session 从不透明 UUID 改为结构化 key：

```text
agent:<agentId>:main                                  # 顶层用户 session
agent:<agentId>:subagent:<uuid>                       # Phase 12 子代理
agent:<agentId>:subagent:<uuid>:subagent:<uuid>       # 深度 2 嵌套（Phase 12）
agent:<agentId>:background:<uuid>                     # Scheduler 启动
```

Key 在不引入独立元数据字段的情况下编码 lane 归属与父子关系。现有 session 一次性迁移：UUID 成为尾段，`agentId` 默认为 `default`。

### 跨进程文件锁

Session lane 能挡住进程内竞争，但挡不住第二个 `vole` 实例写同一份 JSONL。Phase 11 加入 `acquireSessionFileLock(sessionId, options)` 工具：

- 在 sessions 目录使用一个 `.lock` 旁车文件。
- 进程感知：写入 PID 与启动时间；陈旧锁（PID 已死）被回收。
- 可配置 acquire 超时，默认 60000 ms。
- 包裹 `packages/sessions` 中每次 JSONL 追加。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`lanes.md` + zh-CN、`gateway.md` 重写 + zh-CN、`run-queue.md` 更新 + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **feat(lanes)**：新 `packages/lanes`，含 `Lane`、`LaneRegistry`、测试。
3. **feat(gateway)**：`GatewayCore` 整合 session 注册表、lane 路由、取消能力、测试。
4. **feat(sessions)**：跨进程文件锁、与现有 JSONL store 集成、测试。
5. **refactor(cli,web)**：迁移 adapter，改为通过 gateway 提交；移除直接构造 `AgentRuntime`；移除 `SessionMutex` 使用。
6. **feat(cli)**：`vole gateway status` 命令。
7. **docs**：标记 Phase 11 完成，附 commit 哈希。

## 5. 验收标准

- 每次提交都通过 `pnpm run check` 与 `pnpm run check:bundle`。
- 一个测试向同一 session lane 并发提交 100 个请求；所有 run 按提交顺序完成，无 JSONL 损坏。
- 一个测试在同一 session 上同时启动两个 `vole` 进程；文件锁正确串行化二者，无写入丢失。
- `vole gateway status` 打印当前 lane 占用与队列深度。
- 移除 `SessionMutex` 不改变单 session CLI 的可观察行为。
- 新 session key 格式向后兼容：旧 session 仍可读，并在首次写入时惰性迁移。

## 6. 非目标

- 不做 gateway HTTP / Unix socket 传输。
- 不做多进程 gateway daemon。
- 不做远程客户端协议。
- 不引入新的权限语义。
- 不做 SQLite（Phase 14）。
- 除 session key 形态外，不改子代理行为（Phase 12）。

## 7. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Gateway](../architecture/gateway.zh-CN.md)
- [Run Queue](../architecture/run-queue.zh-CN.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.zh-CN.md)
- [OpenClaw 对齐计划](./openclaw-alignment.zh-CN.md)

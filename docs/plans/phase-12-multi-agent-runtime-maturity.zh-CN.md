# Phase 12：多代理运行时成熟化

状态：完成
日期：2026-05-11

English version: [phase-12-multi-agent-runtime-maturity.md](./phase-12-multi-agent-runtime-maturity.md)

## 进度

状态：完成

已完成提交：

- [x] Step 1：docs(arch) 重写 `multi-agent-runtime.md` 适配 Phase 12 — `25b76f2`
- [x] Step 2：feat(taskflow) `PendingAnnouncement` 类型、`pendingAnnouncement` 字段、`drainPendingForParent` — `61c4f7a`
- [x] Step 3：feat(core,cli) `AgentRuntime.runTurn` 中的推送完成 drain + CLI 接线 — `689f431`
- [x] Step 3 补充：feat(core) async 子代理完成时写 `pendingAnnouncement` + NO_REPLY 抑制 — `0ec50b5`
- [x] Step 4：feat(core,tools,cli) `SubagentFactoryOptions`、`fork` 上下文模式、按深度剥工具 — `b6b4498`
- [x] Step 5：feat(gateway) per-parent `maxChildrenPerAgent` + `runTimeoutSeconds` — `908de02`
- [x] Step 6：feat(core,adapters,cli) `subagents` 管理工具 + `vole subagents` CLI — `9938aff`
- [x] Step 7：docs 标记 Phase 12 完成 + roadmap 更新 — （本次提交）

## 1. 目的

Phase 12 把 Vole 的子代理系统从"勉强够用的单次 spawn"升级到 OpenClaw 同级别的多代理执行：推送式完成通知、`fork` 上下文模式、深度与并发策略，以及检视 / 控制面板。

Phase 10 交付了 `spawn_subagent`、`spawn_subagent_async`、`check_subagent`，但实现刻意最小化：父代理必须轮询，深度仅靠"不把 spawn 工具装给子代理"来隐式控制，上下文永远是 `isolated`，没有任何方式取消、超时或干预运行中的子代理。`openclaw-alignment.md` Gap 15 中设计的 `fork` 模式也从未实现。

本 phase 依赖 Phase 11 的 lane 基础设施做并发控制，以及结构化 session key 做父子追踪。

## 2. 范围

本 phase 包含：

- TaskFlow 记录新增 `pendingAnnouncementForParent` 字段；运行时在每次父代理回合开头 drain，并把每个已完成 child 的描述以 system 消息注入。
- `SubagentFactory.create(goal, options)` 接受 `{ contextMode: "isolated" | "fork", parentMessages?, depth, parentSessionKey }`。
- `fork` 模式在子 session 首次回合之前拷贝父代理的对话历史。
- Lane 强制并发：subagent lane 限制全局并行 child；per-parent `maxChildrenPerAgent`（默认 5）限制单父代理的活跃 child 数。
- 深度策略：`maxSpawnDepth`（默认 1，orchestrator 2，硬上限 5）；当深度达到或超过上限时，factory 从子代理工具列表中剥离 `spawn_subagent*`。
- 取消：`runTimeoutSeconds` 参数让 lane 调度器在 deadline 到达时中止 child 运行；`cancel(runId)` 级联至所有后代。
- 子代理管理面板：新 `subagents` 工具族，子命令 `list`、`log`、`info`、`kill`、`steer`、`send`。
- CLI 命令：`vole subagents list`、`vole subagents kill <id|all>`。

本 phase 不包含：

- 子代理跑在独立 OS 进程或 worker thread（Phase 16 才考虑）。
- 每个 child 独立的 agent 身份（Phase 15）。
- Channel 触发的子代理（Phase 15）。
- 跨机器子代理派发。

## 3. 架构摘要

### 推送式完成

完成的子代理把终态摘要写入其 TaskFlow 记录，并在父记录的 `pendingAnnouncementForParent` 中加入一条结构化条目。父代理下一次 `runTurn` 时，运行时在装配 system prompt 之前 drain 这些待通知条目，并作为 `system` 角色消息注入：

```text
[subagent #abc123 completed]
goal: "Refactor authentication middleware"
status: succeeded
result: <terminal summary>
```

投递使用幂等键（taskId），重试不会重复。投递失败按指数退避重试，重试上限较小；持续失败以运行时 warning 事件浮现。

### 上下文模式

两种 spawn 模式：

- `isolated`（默认）：子 session 以全新 transcript 创建，仅包含 goal 和可选 context 字符串。
- `fork`：spawn 时父代理的消息历史在第一回合前拷贝至子 session。Token 成本更高，适合上下文敏感的委派。

`SubagentFactory` 决定拷贝什么。默认 `fork` 仅包含 assistant + user 消息（不含 tool call 记录）以控制 token 用量。Child 仍在自己的 session lane 中，写入自己的 JSONL。

### 深度与并发策略

两层强制：

1. spawn 时剥离工具列表。factory 构造 child 的 `ExecutableTool[]` 时，如果 `depth >= maxSpawnDepth`，删除 `spawn_subagent`、`spawn_subagent_async`、`subagents`。模型字面上无法调用。
2. 基于 lane 的准入控制。subagent lane 强制全局并行；`GatewayCore` 内部的 per-parent 计数器强制 `maxChildrenPerAgent`。超出的提交排队而非立即 spawn。

默认值对齐 OpenClaw：`maxSpawnDepth=1`、`maxChildrenPerAgent=5`、subagent lane 并发 8。三者均可通过 `agents.defaults.subagents.*` 配置。

### 子代理管理面板

新的 `subagents` 工具向父代理与人类提供管理界面：

```ts
{ command: "list" }                         → { children: [...] }
{ command: "log",   taskId }                → { events: [...] }
{ command: "info",  taskId }                → { record: {...} }
{ command: "kill",  taskId | "all" }        → { stopped: [...] }
{ command: "steer", taskId, message }       → { delivered: bool }
```

`kill` 沿 session key 树级联，因此 kill 一个 depth-1 orchestrator 会停掉它派生的每个 depth-2 child。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`multi-agent-runtime.md` 重写 + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **feat(taskflow)**：加入 `pendingAnnouncementForParent` 字段与 store helper；测试。
3. **feat(core)**：在 `AgentRuntime.runTurn` 中 drain 待推送通知；用合成 TaskFlow store 做测试。
4. **feat(core,tools)**：`SubagentFactory` 选项 `contextMode`、`depth`、`parentSessionKey`；`fork` transcript 拷贝；按深度剥离工具。
5. **feat(gateway)**：per-parent child 计数器与 `maxChildrenPerAgent` 准入控制；`runTimeoutSeconds` 截止调度。
6. **feat(tools,cli)**：`subagents` 工具族与 `vole subagents` CLI 子命令。
7. **docs**：标记 Phase 12 完成。

## 5. 验收标准

- 每次提交都通过 `pnpm run check`。
- 父代理 spawn 三个 async child，三者完成后续回合自动按完成顺序投递通知，无重复。
- 以 `contextMode: "fork"` spawn 的 child 可访问父代理之前的 assistant / user 消息。
- 测试验证 depth-2 child 没有注册任何 `spawn_subagent*` 工具。
- 测试验证某父代理的第 6 个并发 child 处于排队状态而非运行。
- `vole subagents kill <id>` 在 1 秒内停止指定 child 及其所有后代。
- `runTimeoutSeconds: 5` 在 6 秒内中止失控 child 并报出 `timed_out` 状态。

## 6. 非目标

- 不做 child 的进程或线程隔离。
- 不做每个 child 独立 auth 或 SOUL.md 覆盖（Phase 15）。
- 不把 child 事件流并入父代理对用户可见的事件流。
- 不引入新的 channel 集成。
- 不做 SQLite TaskFlow store（Phase 14）。

## 7. 相关文档

- [Phase 11 Gateway 与 Lane 基础设施](./phase-11-gateway-and-lanes.zh-CN.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.zh-CN.md)
- [Task Flow](../architecture/task-flow.zh-CN.md)
- [OpenClaw 对齐计划](./openclaw-alignment.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

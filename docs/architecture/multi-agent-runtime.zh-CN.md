# Multi-Agent Runtime

状态：Phase 10 基线；Phase 12 把推送完成、fork 模式、深度 / 并发策略和 `subagents` 管理面板做实
日期：2026-05-11

English version: [multi-agent-runtime.md](./multi-agent-runtime.md)

## 1. 目的

本文档描述 Vole 如何协调多个 `AgentRuntime` 实例运行。Phase 10 引入进程内子代理，完成机制是轮询的；Phase 12 把这套系统做到生产形态：完成自动 push 回父代理，`fork` 上下文模式拷贝父 transcript，lane 准入强制 per-parent child 上限与 OS 级超时，`subagents` 工具族与 CLI 让运行时可检视、可控制。

子代理仍在进程内运行。跨进程或跨机器派发到 Phase 16 之前都明确不在范围内。

## 2. 子代理概念

子代理是父代理派生的第二个 `AgentRuntime` 实例，用来处理聚焦的子任务。父代理委派目标；子代理运行在自己的 session lane、自己的工具集、自己的步数上限、（可选）父代理 transcript 的副本之上。

两种上下文模式：

- **`isolated`**（默认）—— 子代理 session 除 `goal` 和可选 `context` 字符串外为空。Token 便宜；适合工作自包含的场景。
- **`fork`** —— 父代理近期 assistant/user 消息在第一回合前被拷贝进子 session。Token 更贵；适合工作依赖父代理已有上下文的场景。默认不拷贝工具调用记录，控制 token 用量。

子代理适用于：

- 子任务需要独立、聚焦的执行上下文。
- 父代理希望把界限清晰的目标并行委派出去。
- 父代理不希望中间步骤污染自己的对话历史。

## 3. SubagentFactory 接口

工厂接受一个 options 包，让 gateway 和工具层把 child 放入正确的上下文、正确的深度、正确的 session key 之下：

```ts
export interface SubagentFactoryOptions {
  contextMode?: "isolated" | "fork";
  parentMessages?: ReadonlyArray<{ role: string; content: string | null }>;
  depth?: number;
  parentSessionKey?: string;
}

export interface SubagentFactory {
  create(goal: string, options?: SubagentFactoryOptions): AgentRuntime;
}
```

工厂由 adapter（CLI 或 Web）用 config / provider / built-in tools 一次构造。每次 `create` 调用构建一个新的 `AgentRuntime`：

- 当 `contextMode === "fork"`，工厂在首次回合前把提供的 `parentMessages` 作为 `recentMessages` 传给 runtime。
- 当 `depth >= maxSpawnDepth`（默认 1；orchestrator 为 2），工厂在构造 runtime 前从工具列表中剥离 `spawn_subagent`、`spawn_subagent_async`、`subagents`。模型字面上无法递归到允许深度之下。
- `parentSessionKey` 用于派生 child session key（`<parent>:subagent:<uuid>`）。

工厂不强制并发上限 —— 那是 gateway 的工作（见 §6）。

## 4. Spawn 工具族

四个模型可调工具住在 `@vole/tools` 与 `@vole/core`：

| 工具 | 风险 | 何时用 | 返回 |
|---|---|---|---|
| `spawn_subagent` | medium | 子任务必须先完成父代理才能继续 | child 返回后 `{ ok, result }` |
| `spawn_subagent_async` | medium | 子任务可在后台跑 | 立即 `{ taskId, status: "queued" }` |
| `check_subagent` | low | 父代理想轮询之前派生的 async child | `{ status, result }` |
| `subagents` | low | 父代理（或人）想列出 / 检视 / 控制 children | 命令形态响应 |

`subagents` 是 Phase 12 加入的管理族。它的子命令：

```ts
{ command: "list" }                  → { children: RunHandle[] }
{ command: "log",   taskId }         → { events: ... }       // 尚未实现；预留
{ command: "info",  taskId }         → { record: ... }
{ command: "kill",  taskId | "all" } → { stopped: string[] }
{ command: "steer", taskId, message }→ { delivered: bool }   // Phase 15 channel 预留
{ command: "send",  taskId, message }→ { delivered: bool }   // 预留
```

Kill 沿 session-key 树级联，因此 kill 一个 depth-1 orchestrator 会停掉它派生的每个 depth-2 child。

## 5. 推送式完成

Phase 10 父代理必须轮询 `check_subagent`。Phase 12 反转：async 子代理完成时，它在父代理的 TaskFlow 记录上写一条 `pendingAnnouncementForParent`。父代理下一次 `runTurn` 在装配 system prompt 之前 drain 待通知列表，把每条作为 `system` 角色消息注入：

```text
[subagent #abc123 completed]
goal: Refactor authentication middleware
status: succeeded
result: <terminal summary>
```

投递规则：

- 每条携带 `taskId` 作为幂等键。注入后立即清除，父代理永不重复看到同一通知。
- 失败与超时 child 产出带 `status: "failed"` / `status: "timed_out"` 的通知和简短 terminal summary 而非原始栈。
- 子代理把 silent token `NO_REPLY`（或 `no_reply`）作为 assistant 文本输出时，完全抑制通知 —— 适合"投了就忘"的后台工作，不打扰父代理。

父代理仍可调用 `check_subagent` 做显式轮询；push 路径是叠加的，不排他。

## 6. 并发、深度与超时策略

三层策略叠在 `@vole/lanes` 准入链之上：

| 层 | 默认 | 所属 | 行为 |
|---|---|---|---|
| Global lane | 16 并发 | `LaneRegistry`（Phase 11） | 所有 run 的总并行 |
| Subagent lane | 8 并发 | `LaneRegistry`（Phase 11） | 所有子代理 run 的总并行 |
| Per-parent 计数器 | `maxChildrenPerAgent: 5` | `GatewayCore`（Phase 12） | 单父代理 session 的活跃 children |
| Spawn 深度 | `maxSpawnDepth: 1`（orchestrator: 2；硬上限: 5） | `SubagentFactory`（Phase 12） | 递归可深到哪 |
| Run 超时 | `runTimeoutSeconds: 0`（关） | `GatewayCore`（Phase 12） | per-child run 的墙钟预算 |

Per-parent 准入在 lane 链之前发生：单父代理的第 6 个并发 child 在 gateway 排队，不在 subagent lane 排队。这避免一个失控父代理把所有其他父代理在 subagent lane 上饿死。

深度强制是结构性的：工厂仅在深度达到上限时从工具列表移除 spawn 工具。模型不能调用它没有的东西。

Run 超时实现为带 `setTimeout` 的 `AbortController`。计时器触发时，gateway 调 `cancel(runId)`，run 在下一个安全检查点中止，通知里浮现 `timed_out` 状态。

## 7. 参考

- [Lanes](./lanes.zh-CN.md) —— 准入与串行化原语
- [Gateway](./gateway.zh-CN.md) —— submit / cancel / status 表面
- [Task Flow](./task-flow.zh-CN.md) —— TaskFlow 记录与 pendingAnnouncementForParent 字段
- [Agent Loop](./agent-loop.zh-CN.md) —— 子代理运行的 runtime 循环
- [Phase 12 计划](../plans/phase-12-multi-agent-runtime-maturity.zh-CN.md)

# Lanes

状态：计划中（Phase 11）
日期：2026-05-11

English version: [lanes.md](./lanes.md)

## 1. 目的

Lane 是 Vole 的 run 准入与串行化原语。一个 lane 是一个带可配置并发上限的 FIFO 队列；gateway 接受的每个 run 在执行前都必须穿过一条或多条 lane。

本文档规范 Phase 11 引入的 lane 模型，以及 gateway、sessions、子代理如何与之组合。它取代了通过 `SessionMutex` 做的临时串行化，并为子代理并发策略、channel 路由和跨进程安全做铺垫。

## 2. Lane 概念

`Lane` 是最简单的调度器：

```ts
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}
```

行为：

- 提交的工作按提交顺序出队。
- 同时最多有 `maxConcurrent` 项在运行；之后的提交等待。
- 活跃槽位释放时，下一个排队项开始运行。
- 返回的 promise 以工作结果 resolve，或以抛出的错误 reject。

Lane 对内部跑什么不持任何意见。Gateway 决定一个 run 适用哪些 lane，并用基于 `Promise` 的组合串起来。

## 3. 三层默认 Lane

Phase 11 交付三层 lane；每个被接受的 run 都被所有适用的层级闸门约束：

| Lane key | 默认并发 | 范围 | 用途 |
| --- | --- | --- | --- |
| `global` | 16 | 每个 run | 无上限并行的兜底防线 |
| `subagent` | 8 | 仅子代理触发的 run | 限制所有父代理下并行 child 的总量 |
| `session:<sessionId>` | 1 | 单个 session | 严格串行化 per-session 写入 |

用户触发的 CLI run 穿过 `global` 与对应的 `session:<id>`。`spawn_subagent_async` 触发的 run 穿过 `global`、`subagent` 与其 child `session:<id>`。

Per-session 并发 1 完全复现之前 `SessionMutex` 的语义。Session lane 因此是 mutex 的严格泛化。

## 4. 准入控制

准入是组合，不是分支。Gateway 把工作包进 lane 链：

```text
gateway.submit(req) ≡
  globalLane.enqueue(() =>
    (req.isSubagent ? subagentLane.enqueue(work) : work()))
```

其中 `work` 本身是 `sessionLane(req.sessionId).enqueue(() => runtime.runTurn(req))`。

Per-parent 上限（Phase 12 使用的 `maxChildrenPerAgent` 策略）叠加在其上：gateway 按父 session 跟踪活跃 child 数，一旦达到上限就在进入 lane 链之前拒绝准入。Lane 系统本身不感知父 / 子语义。

## 5. Lane 生命周期

Lane 惰性创建，与 `GatewayCore` 同生命周期。

- `global` 与 `subagent` 自 gateway 构造起存在。
- `session:<id>` lane 首次访问时创建，并在 session 被引用期间保留。
- Session 被注销且队列为空时 lane 被回收。

Lane 状态是进程内的。对同一 session id 的跨进程串行化由跨进程文件锁负责，不在 lane 职责内。二者组合：进程内 lane 在一个 Node 进程内排序写入；文件锁跨进程排序写入。

## 6. 与 GatewayCore 的组合

`GatewayCore` 是唯一构造 lane 链的调用者。Adapter 提交 `RunRequest`，从不直接接触 lane：

```ts
gateway.submit({
  sessionKey: "agent:default:main",
  agentId: "default",
  message: "...",
  isSubagent: false
});
```

Gateway 解析 session、选 lane 链、运行工作。提交者无法绕开链路；Phase 11 起，没有任何公共路径能在 gateway 外构造 `AgentRuntime` 并调用 `runTurn`。

## 7. 与会话锁的关系

Lane 与跨进程文件锁都在 Phase 11 落地，但解决不同问题：

| 关注点 | Lane | 文件锁 |
| --- | --- | --- |
| 同 Node 进程，同 session | ✓ session lane | （冗余） |
| 同 Node 进程，不同 session | ✓ global / subagent lane | 不涉及 |
| 不同进程，同 session | 不涉及 | ✓ 文件锁 |
| 不同进程，不同 session | 不涉及 | 不涉及 |

Session lane 在文件锁释放句柄之前释放其槽位；读者总是先看到 lane 顺序的写入，跨进程时再看到文件系统顺序。

## 8. 测试要求

Lane 测试必须覆盖：

- 高并发入队负载下的 FIFO 顺序。
- 随机到达时间下的并发上限执行。
- 成功与拒绝路径上的槽位释放。
- 与 `GatewayCore.submit` 的组合：session lane 的并发 1 产生 `runTurn` 调用的严格顺序。
- 子代理 run 与父代理 run 共享 `global` 时无饥饿。
- session 在队列非空时被注销，lane 先排空再回收。

`vole gateway status` 集成测试断言 lane 占用准确反映活跃与排队中的 run。

## 9. 验收标准

Lane 模型在 Phase 11 成功当：

- `SessionMutex` 从 `packages/sessions` 移除；所有 per-session 串行化走 session lane。
- 三层默认 lane 都可通过 `gateway.lanes.*` 配置键配置。
- 同一 session lane 上 100 个并发提交按提交顺序完成，JSONL 无损坏。
- 父代理 spawn 12 个 async 子代理时，最多 8 个并发运行（subagent lane 上限）。
- 从代码路径移除 lane 系统后，刻意的回归测试失败。

## 10. 参考

- [Phase 11 计划](../plans/phase-11-gateway-and-lanes.zh-CN.md)
- [Gateway](./gateway.zh-CN.md)
- [Run Queue](./run-queue.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md)

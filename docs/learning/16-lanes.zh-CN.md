# 模块 15：@vole/lanes

状态：完成（Phase 11 Step 2）
日期：2026-05-11

English version: `16-lanes.md`

相关源码：`packages/lanes/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md) Stage 4（扩展系统）的一部分。读之前请先读
[13-gateway.zh-CN.md](./13-gateway.zh-CN.md) —— `LaneRegistry` 是 Phase 11 Step 3 中新 `GatewayCore`
用来准入和串行化 run 的原语。

**阅读前**：完整阅读 `packages/lanes/src/index.ts`（不到 150 行，无依赖）。然后读
`packages/lanes/src/index.test.ts` —— 测试就是诚实的用法文档，尤其是 FIFO 顺序测试和"默认上限下 12 个子代理"场景。

**关注问题**：

- `Lane` 不过是带并发上限的 FIFO 队列。Gateway 用它做的事情，旧的 `SessionMutex` 做不到吗？
- `releaseSessionLane` 只对空闲 lane 返回 `true`。如果不管 active 数量都释放，会出什么问题？
- `runThroughLanes` 链路是 `global → 可选的 subagent → session`。为什么 `session` 在最内层？

**检查点**：当你能在纸上画出准入链、指出每层在何时获取与释放槽位，并解释为何这是对单一 mutex 设计的严格泛化（且不改变 CLI 单 session 情况下的可观察行为）时，你就理解了本模块。

## 1. 本模块做什么

**通俗讲**：想象一个机场有三个检查站。第一个检查站控制大楼里总人数。第二个只针对某个旅行团（子代理）。第三个是一个航班（session）的登机口 —— 同一时刻只让一个人通过。乘客必须通过所有适用的检查站才能登机。`@vole/lanes` 就是这个机场。

**技术摘要**：`@vole/lanes` 提供 `FifoLane`（带可配置并发上限的 FIFO 队列）和 `LaneRegistry`（持有三层默认 lane：global、subagent、每 session 一个），gateway 把它们组合成每个被接受的 run 在执行前必须穿过的准入链。`runThroughLanes` 帮手按顺序应用该链。本 package 不依赖其他 workspace package。

## 2. 为什么存在

Phase 0–10 使用 `@vole/sessions` 里单一的 `SessionMutex` 串行化 per-session 写入。这对单用户单 shell 够用。随 Vole 演进，出现三个新约束：

- 子代理 spawn 可产生大量并发 run；无上限时模型能用并行 child 淹没进程。
- 多个 adapter（CLI、Web、scheduler、未来的 channel）都想为同一 workspace 提交工作；runtime 需要单一的准入点。
- 需要全局并行兜底，防止某个失控的 spawner 耗尽资源。

没有 lane 时，每个 adapter 都要自己重新实现准入和 per-session 顺序，每个还都略有不同。Lane 原语把这些塌缩为统一、可测的调度器。

## 3. 公共接口

```ts
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}

class FifoLane implements Lane {
  constructor(options: { key: string; maxConcurrent: number });
}

class LaneRegistry {
  constructor(options?: {
    globalConcurrency?: number;    // 默认 16
    subagentConcurrency?: number;  // 默认 8
    sessionConcurrency?: number;   // 默认 1
  });
  readonly global: Lane;
  readonly subagent: Lane;
  sessionLane(sessionId: string): Lane;
  releaseSessionLane(sessionId: string): boolean;
  status(): LaneRegistryStatus;
}

function runThroughLanes<T>(
  registry: LaneRegistry,
  options: { sessionId: string; isSubagent?: boolean },
  work: () => Promise<T>
): Promise<T>;

const DEFAULT_LANE_CONCURRENCY: { global: 16; subagent: 8; session: 1 };
```

所有导出都在 `packages/lanes/src/index.ts`。无 re-export，无子模块。

## 4. 实现走读

### FifoLane：enqueue 与槽位释放

```ts
async enqueue<T>(work: () => Promise<T>): Promise<T> {
  if (this.#active >= this.maxConcurrent) {
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
  }
  this.#active++;
  try {
    return await work();
  } finally {
    this.#active--;
    const next = this.#waiters.shift();
    if (next !== undefined) next();
  }
}
```

槽位在 `finally` 中释放，因此 rejected 的 work 函数不会泄露容量。Waiter 以 `() => void` 恢复回调存储，FIFO 出队。本层无优先级、无抢占、无取消 —— 让原语保持小。

构造时校验 `maxConcurrent` 必须是正整数。早期设计调度器常见 bug 是默默接受 `0` 然后死锁；用断言让失败显式。

### LaneRegistry：懒创建 session lane 与仅空闲回收

```ts
sessionLane(sessionId: string): Lane {
  let lane = this.#sessionLanes.get(sessionId);
  if (lane === undefined) {
    lane = new FifoLane({
      key: `session:${sessionId}`,
      maxConcurrent: this.#sessionConcurrency
    });
    this.#sessionLanes.set(sessionId, lane);
  }
  return lane;
}

releaseSessionLane(sessionId: string): boolean {
  const lane = this.#sessionLanes.get(sessionId);
  if (lane === undefined) return false;
  const { active, queued } = lane.occupancy();
  if (active === 0 && queued === 0) {
    this.#sessionLanes.delete(sessionId);
    return true;
  }
  return false;
}
```

懒创建意味着启动时注册表 session lane 数为 0。仅空闲回收是关键不变式：移除仍有 queued waiter 的 lane 会让等待者成为孤儿。布尔返回值让调用方（gateway 清理、doctor 命令）区分"已移除"与"仍在使用"。

### runThroughLanes：链路组合

```ts
const sessionLane = registry.sessionLane(options.sessionId);
const runInner = () => sessionLane.enqueue(work);
const runWithSubagent = () =>
  options.isSubagent === true ? registry.subagent.enqueue(runInner) : runInner();
return registry.global.enqueue(runWithSubagent);
```

从下往上读。`work` 包在 session-lane enqueue 中（最内层）。若是子代理 run，session-lane enqueue 包在 subagent-lane enqueue 中。整体包在 global-lane enqueue 中（最外层）。每条 lane 控制自己的 waiter；内层 lane 饱和时回压向外传播。

## 5. OpenClaw 对齐

| OpenClaw | Vole | 注 |
|---|---|---|
| `pi-embedded-runner/lanes.ts`（session lane + global lane） | `LaneRegistry` | 相同的 per-session + global 结构 |
| Per-session 严格串行 | `sessionLane(id)` 取 `maxConcurrent: 1` | 语义相同；替换 `SessionMutex` |
| Subagent lane（`subagents.maxConcurrent`） | `LaneRegistry.subagent` | 默认 8，相同 |
| Lane 占用上报 | `Lane.occupancy()` + `LaneRegistry.status()` | 形态相同，未来供 `vole gateway status` 使用 |
| Per-parent `maxChildrenPerAgent` | 叠在 lane 之上（Phase 12） | Lane 不感知 parent 身份 |

最大差异：OpenClaw 的 lane 绑在 embedded runner 内部。Vole 把它们暴露为独立小 package，因为 gateway、scheduler 与未来的 channel 都需要准入控制。

## 6. 关键设计决策

**三层，不是四层或两层。** 两层（global + session）无法把子代理并行与其他工作区分开。四层会鼓励每个未来调用方（channel、定时任务等）随手加层，最终组合爆炸。三层匹配 OpenClaw 并覆盖真正的区分：总工作、子代理工作、per-session 工作。

**Lane 不感知父 / 子关系。** `maxChildrenPerAgent`（Phase 12）住在 gateway，不在 lane。Lane 原语刻意身份无关；在此加 parent 计数器会把准入与多代理模型耦合，阻碍未来复用。

**槽位释放在 `finally`，不在 `await` 之后。** 一种朴素实现可能写 `work(); this.#active--;` 而非 `finally`。`work()` rejected 时就出问题。`finally` 释放是确保容量无论 work 怎样都能归还的唯一正确方式。

**`runThroughLanes` 作为函数而非方法。** 把链路组合放在 `LaneRegistry` 上会诱使调用方把链路构造与 lane 访问混在一起。保留为自由函数强制 gateway 显式声明它在组合什么，并且让链路无需 registry 也好测试。

## 7. 测试方式

测试在 `packages/lanes/src/index.test.ts`。16 个测试覆盖：

- `FifoLane` 构造校验（拒绝 0、负数、小数）。
- 100 个并行提交到 `maxConcurrent: 1` 的 lane 时的严格 FIFO。
- 随机到达时间下的并发上限执行。
- 成功 / 拒绝路径上的槽位释放。
- 失败后后续 waiter 按提交顺序运行。
- `LaneRegistry` 默认并发、session-lane 懒创建与复用、仅空闲回收、status 快照。
- `runThroughLanes` 链路顺序、subagent vs 非 subagent 派发、无跨层饥饿。
- Phase 11 验收：100 个并行 session-lane 提交按顺序完成；默认设置下 12 个子代理提交最多 8 个并发。

所有测试是同步风格的 async/await；本模块无依赖，无需 fake。`deferred<T>()` 帮手让 work 执行可控以做确定性的时序断言。

## 8. 洞见

**Lane 与 mutex 不同。** mutex 保证互斥；并发为 1 的 lane 恰好做了这件事，但其抽象是带上限的 FIFO 调度。把两者混为一谈会在调用方需要并发 2 或 8 时犯错。

**Session lane 是 `SessionMutex` 的严格泛化。** 当 `maxConcurrent: 1` 时，可观察行为完全相同：同一时刻只有一个 writer，其他按提交顺序等待。这种泛化换来与其他层组合的能力 —— 这是 mutex 做不到的。

**回收策略保守是有意为之。** 看起来空闲了一微秒的 lane，下一拍可能被一个待处理的提交重新获取。Gateway 应该只在 session 显式注销后才调 `releaseSessionLane`；否则不断的空闲抖动会让 lane 一直被重建。

**本 package 无依赖是有理由的。** 任何未来调用方（一个工具、一个 doctor 命令、一个 benchmark）都能 import `@vole/lanes` 而无需拖入 runtime、sessions、models。小表面让接缝稳定。

## 9. 复习问题

1. 为什么 `FifoLane.enqueue` 用 `Promise<void>` waiter 数组而非 `Promise<T>`？
   > 不同 work 提交有不同返回类型。Waiter 只发"现在轮到你"信号；真实 work 值通过 `enqueue<T>` 返回的 promise 流走。把它们混在一起会强制 lane 在不需要泛型的地方泛型化。

2. 队列中有 waiter 时调 `releaseSessionLane` 会发生什么？
   > 返回 `false` 且不删除 lane。删除会让 waiter 成为孤儿并泄漏触发它们的 work。Lane 仅在 `active` 与 `queued` 都为 0 时回收。

3. `runThroughLanes` 链接三层。为什么 session lane 最内层？
   > Per-session 写入是最严格约束（并发 1）。把 session lane 放最内层意味着 session-mutating work 完成后槽位立即释放，让下一个 session-bound 提交可用，而更外层（subagent、global）仍占用以承载外层组合可能引入的收尾成本。

4. 两个 `vole` 进程指向同一 session。它们的 lane 协调吗？
   > 不。每个进程有自己的 `LaneRegistry` 与该 session id 的 session lane。跨进程串行化是跨进程文件锁的职责（Phase 11 Step 4 在 `@vole/sessions`）。两层组合：lane 在一个 Node 进程内排序写入；文件锁跨进程排序写入。

5. 当 `SessionMutex` 被 session lane 替换，CLI 单 session 用户感受到什么变化？
   > 可观察上什么都没变。并发 1 的 session lane 是 mutex 的严格泛化。新代码路径还能与 global、subagent lane 干净组合，因此后续加子代理无需再回过头改 per-session 串行化。

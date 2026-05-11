# 模块 12：@vole/gateway

状态：完成（Phase 11 Step 3 重写）
日期：2026-05-11

英文版：`13-gateway.md`

相关源码：`packages/gateway/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md) Stage 4（扩展系统）的一部分。读之前请先读
[16-lanes.zh-CN.md](./16-lanes.zh-CN.md) —— `GatewayCore` 将那里定义的 `LaneRegistry`
组合成每个 run 必须穿过的准入链。

**阅读前**：通读 `packages/gateway/src/index.ts`。它是一份文件，含两个类（`SessionGateway`、
`GatewayCore`）、一个内部队列辅助类、若干类型。再读 `packages/gateway/src/index.test.ts` ——
lane 排序测试是理解为何要做准入的最清晰例子。

**关注问题**：

- Gateway 从不 import `@vole/core`。那它如何调用 `AgentRuntime.runTurn`？
- `cancel(runId)` 立即返回。Run 实际什么时候停下？
- 从调用方视角看 `submit` 是 async generator。为什么 lane-chained 的工作是 fire-and-forget，而不是在同一个 generator 里 `await`？

**检查点**：当你能画出一次 submit 的完整路径 —— 从调用方的 `gateway.submit(req)`、穿过 lane 准入、进入 run 函数、再以可迭代事件流出 —— 并解释每个 early-exit（取消、错误、完成）住在哪里时，你就理解了本模块。

## 1. 本模块做什么

**通俗讲**：Gateway 像饭店前台 + 排队管理员。每位客人（run）从同一扇门（`submit`）进来。前台检查包间剩余容量（global lane、subagent lane、客人预订的座位 = session lane），有座时引导入座，让厨房（调用方的 run 函数）开始备餐。出菜（事件）时前台维护一份当前就座者名单（`activeRuns`），经理可借此请人离开（`cancel`）或打印 status 报告（`status`）。

**技术摘要**：`@vole/gateway` 提供两个协作的类。`SessionGateway` 是进程内活跃 session 注册表
（register / unregister / touch / list）。`GatewayCore` 在此之上扩展 `submit`、`cancel`、`status` ——
把每个 run 穿过 `@vole/lanes` 提供的 global、subagent、session 三层 lane；按 `runId` 跟踪活跃 run
以便取消；为 `vole gateway status` 命令报告 lane 占用。Package 不依赖 `@vole/core`；调用方把真实的 runtime
调用作为 `run` 函数提供。

## 2. 为什么存在

Phase 10 之前，adapter 直接构造 `AgentRuntime` 并用 `SessionMutex` 串行化 per-session。这对单用户单 shell 够用。
Vole 演进后开始失效：

- 多个 adapter（CLI、Web、scheduler、未来的 channel）都想为同一 workspace 启动 run。没有集中准入点时，每个 adapter 都要自己重新实现排队。
- 子代理 spawn 能产生大量并发 run。无上限并发会损坏状态、耗尽资源。
- Cancel 需要单一权威点。两个 adapter 同时 cancel 同一个 run 不应竞争。
- `vole gateway status` 命令需要一个读取实时占用的地方。

Gateway 集中处理这四件事。Phase 11 起每个 run 都过它。

## 3. 公共接口

```ts
interface GatewaySession {
  id: string;
  adapterName: string;            // "cli" | "web" | "background" | ...
  capabilities: AdapterCapabilities;
  registeredAt: string;
  lastActivityAt: string;
}

class SessionGateway {
  register(session: GatewaySession): void;
  unregister(sessionId: string): void;
  touch(sessionId: string): void;
  get(sessionId: string): GatewaySession | undefined;
  list(): GatewaySession[];
  listByAdapter(adapterName: string): GatewaySession[];
}

interface RunRequest<TEvent = unknown> {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent?: boolean;
  run: (signal: AbortSignal) => AsyncIterable<TEvent>;
}

interface RunHandle {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent: boolean;
  startedAt: string;
}

interface GatewayStatus {
  lanes: LaneRegistryStatus;
  activeRuns: RunHandle[];
}

class GatewayCore extends SessionGateway {
  constructor(options?: { lanes?: LaneRegistryOptions; now?: () => string });
  submit<TEvent = unknown>(req: RunRequest<TEvent>): AsyncIterable<TEvent>;
  cancel(runId: string): boolean;
  status(): GatewayStatus;
}
```

`SessionGateway` API 与 Phase 10 完全相同 —— 保留基线测试不被破坏。其余都是 Phase 11 Step 3 新加。

## 4. 实现走读

### submit：lane 链 + 异步队列

`submit` 的概念流程：

1. 为本 run 分配 `AbortController`。
2. 把 run 注册到 `#activeRuns`，让 `cancel` 与 `status` 找得到。
3. 构造 `AsyncEventQueue<TEvent>` 桥接生产者（run 函数）与消费者（调用方迭代返回的 iterable）。
4. Fire `runThroughLanes(this.#lanes, { sessionId, isSubagent }, work)`。注意：不 await。
   这是 fire-and-forget：lane 链异步执行，我们立刻返回队列。
5. 当 `runThroughLanes` 解决（工作完成，或准入前失败），close 或 fail 队列，并从 `#activeRuns` 移除该 run。
6. 把队列作为 async iterable 返回给调用方。

Fire-and-forget 是同时做到"立刻准入"和"让调用方懒迭代"的唯一办法。如果我们在 async generator 里 await
`runThroughLanes`，调用方就得消费事件才能让准入推进 —— 倒过来了。

### Lane 链内的 work 函数

```ts
async () => {
  if (controller.signal.aborted) return;
  for await (const event of req.run(controller.signal)) {
    if (controller.signal.aborted) break;
    queue.push(event);
  }
}
```

两次 abort 检查：一次在调用 `req.run` 之前（干净处理 cancel-before-admission：run 永不启动），
一次在迭代内（cancel-during-run 时立即停止 push）。调用方的 run 函数也拿到同一 signal，被期望在
更安全的检查点（模型调用之间、工具调用之间）尊重它。

### 活跃 run 的清理顺序

```ts
.then(() => {
  activeRuns.delete(req.runId);
  queue.close();
})
.catch((err: unknown) => {
  activeRuns.delete(req.runId);
  queue.fail(err);
});
```

删除在 close/fail 之前同步完成。这保证：当 consumer 的 iterator 看到 `done: true`（或抛错）时，
`gateway.status().activeRuns` 已经不包含此 run。如果把删除放在 `.finally()`，微任务顺序可能让 status
测试看到陈旧条目。这是一个真实存在的 bug，被 "status reports the active run while it is running" 测试抓到。

### AsyncEventQueue：生产-消费桥

生产者（`push`、`close`、`fail`）与消费者（`Symbol.asyncIterator → next()`）通过三种状态合作：

- Buffer 非空 → consumer 的 `next()` 立即以 head 解决。
- Buffer 空且未关闭 → consumer 的 `next()` 返回一个等候 promise，下一次 `push` 解决它。
- 已关闭 → consumer 的 `next()` 要么以 `{done: true}` 解决，要么以已存错误 reject。

不导出。调用方只看到产出的 `AsyncIterable`。

## 5. OpenClaw 对齐

| OpenClaw | Vole | 注 |
|---|---|---|
| `agentCommand` 编排 | `GatewayCore.submit` | 同样工作：解析 session、准入 run、暴露结果流 |
| Per-session + global 队列准入 | `runThroughLanes` 链 | 形态相同，打包为 `@vole/lanes` |
| `runEmbeddedPiAgent` 调用 | 调用方传给 `submit` 的 `run` 函数 | Vole 反转依赖 —— gateway 从不 import core |
| 推送式取消 | `cancel(runId)` + `AbortController` | 语义相同 |
| Session 写锁（跨进程） | Phase 11 Step 4 在 `@vole/sessions` | 叠在 session lane 之下 |

最大差异：OpenClaw 的 gateway 直接调用 embedded runner。Vole 的 gateway 与 runtime 无关 ——
adapter 通过 `run` 回调把 runtime 接到 gateway。这保持依赖图无环，并让 gateway 不启动 `AgentRuntime`
也能测试。

## 6. 关键设计决策

**Gateway 不 import @vole/core**。直接依赖会迫使 `@vole/gateway` 重新导出每个 runtime 事件类型，
并把准入耦合到特定 runtime 实现。`run` 回调是让两层独立、依赖图干净的接缝。

**`submit` 返回 `AsyncIterable`，而不是 `Promise<AsyncIterable>`**。调用方可立即开始迭代。Lane 准入
在后台推进；首个槽位空出时事件开始流。如果调用方不迭代，run 仍跑到完成，事件没有目的地 —— 队列是缓冲。
这是正确权衡：回压是未来问题；先保证正确性。

**先 delete 再 close，而非 `.finally`**。队列 `close()` 引发的 iterator 解决与 `.finally()` 回调
之间的微任务顺序不确定。把删除放在 close/fail 同函数中能让迭代结束后的 `activeRuns` 状态可预测。

**两次 abort 检查而非一次**。准入前取消与运行中取消最终态相同（不再有事件），但路径不同：前者无需调用
run 函数即返回，后者中断进行中的迭代。两者都值得显式处理以保证可读性。

**Subscribe 推迟**。让第二个 consumer 加入运行中 session 的事件流，在架构文档中提过，但不在 Phase 11。
该用例（Web UI 加入 CLI 正在驱动的 session）只有 channel 存在后才重要。增加它需要队列的多订阅 fan-out，
非平凡。Phase 12 或 Phase 15 再说。

## 7. 测试方式

测试在 `packages/gateway/src/index.test.ts`。覆盖：

- `SessionGateway` 注册表语义（Phase 10 基线测试，未改）。
- `GatewayCore` 继承注册表行为。
- `submit` 把 run 函数的事件流出。
- `status` 执行中报告活跃 run，结束后报告空列表。
- 同 `sessionKey` 的两次 submit 串行化：第二次在第一次完成前不启动。
- 子代理 submit 尊重 subagent lane 上限（cap=2 时 5 个里只 2 个活跃）。
- 抛错的 run 函数把错误传播给 consumer 的迭代。
- `cancel("nonexistent")` 返回 `false`。
- `cancel("active")` 中止 run；run 函数的 `AbortSignal` 触发；run 解开。
- 空闲 gateway 的 `status()` 返回空 lane 占用与无活跃 run。

测试用 `deferred<T>()` 帮手确定性地控制 run 函数 —— 除了不可避免的"让事件循环转一圈"的短 pause，
不用与测试竞争的 `setTimeout` 睡眠。

## 8. 洞见

**Gateway 是粘合层，不是独立层**。它没有领域逻辑。它组合 `SessionGateway`、`@vole/lanes` 与
`AbortController`。这就是全部产品。把它独立成 package 是为了强制单一受理点 —— 不是因为代码大。

**`runThroughLanes` fire-and-forget 是全部窍门**。一旦看清这个细节，其余都顺理成章：队列必须存在
（因为工作与 iterator 解耦）、删除顺序很重要（因为 `.finally` 太晚）、abort 检查必须在 work 函数里
（因为调用方的 run 函数从 fire-and-forget 上下文调用）。

**本 package 不会变大**。Phase 11 在 Phase 10 基线上加约 100 行。Phase 12 会在 activeRuns 跟踪里
叠 per-parent 计数器以执行 `maxChildrenPerAgent`，但只是几行。Phase 15 channel 会引入 session-key
前缀但不改 gateway 形态。本 package 的复杂度上限刻意压低。

**Gateway 是放 `cancel` 的正确地方**。它已经跟踪活跃 run 并持有 AbortController。把 cancel 放别处
（例如 runtime 上）会让每个 adapter 都维护自己的 runId-to-controller 表。集中化消除这种重复。

## 9. 复习问题

1. 什么阻止 `submit` 变成普通 async 函数返回 `Promise<TEvent[]>`？
   > 两件事。第一，调用方希望事件实时出现，不要等结束 —— 对实时 UI 更新有用。第二，缓冲的
   > `Promise<TEvent[]>` 会让 lane 槽位的释放被推迟到整个 run 完成之后。通过 `AsyncIterable` 流式输出
   > 让 consumer 在 run 完成的瞬间看到 `done: true`。

2. Run 函数收到一个 `AbortSignal`。期望它做什么？
   > 在安全检查点检查 —— 下一次模型调用之前、下一次工具调用之前、压缩各阶段之间 —— 一旦 aborted
   > 干净退出。Gateway 也用 abort 检查包了 run 事件流的迭代，因此即使不感知 abort 的 run 也会很快
   > 停止产生可见事件。但调用方尊重 signal 才是正确做法。

3. 一个在 lane 槽位开启前被取消的 run 会怎样？
   > Lane 最终派发被包装的工作；工作的第一个动作是 `if (controller.signal.aborted) return;`，不调用
   > `req.run` 就返回。Lane 槽位短暂持有（一个事件循环 tick）后释放。队列 close，调用方的迭代立即结束。

4. 为什么 gateway 不 import `@vole/core`？
   > 循环依赖风险与 runtime 可移植性。如果 gateway import 了 core，那么任何想组合 gateway 行为的地方
   > （例如未来的 scheduler）都会拖入 runtime。接受 `run` 回调让 gateway 维持薄编排层，任何调用方
   > 都能接线。它也让 gateway 测试平凡 —— 用一个产生假事件的 fake `run` 即可。

5. 如果 run 函数快速 push 1000 个事件但调用方迭代慢呢？
   > 事件在队列的 `#buffer` 中积累。Phase 11 无回压 —— run 继续 emit、buffer 增长、调用方按自己节奏
   > drain。对典型 Vole 负载（每回合少量事件）这是 OK 的。若未来高吞吐用例需要，可以加一个 high-water
   > mark 暂停 run，但不是 Phase 11。

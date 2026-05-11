# Lanes Package

English version: [README.md](./README.md)

## 架构概览

`@vole/lanes` 拥有 **run 准入与串行化原语**：`Lane` 是带可配置并发上限的 FIFO 队列。Gateway 使用 `LaneRegistry` 组合三层默认 lane（global、subagent、per-session）成为每个 run 在 runtime 执行前必须穿过的准入链。

```
gateway.submit(req)
    │
    ▼
runThroughLanes(registry, { sessionId, isSubagent }, work)
    │
    ├─ global lane           （上限 16：兜底）
    │   └─ subagent lane     （上限 8：仅子代理 run）
    │       └─ session lane  （上限 1：严格 per-session 顺序）
    │           └─ work()    （AgentRuntime.runTurn）
```

本 package 刻意保持很小，不依赖任何其他 workspace package。它不感知 `AgentRuntime`、session 存储或 model provider。

## 核心概念

### Lane

```typescript
interface Lane {
  readonly key: string;
  readonly maxConcurrent: number;
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  occupancy(): { active: number; queued: number };
}
```

Lane 是 FIFO 调度器。提交的工作按提交顺序出队；同时最多 `maxConcurrent` 项运行；之后的提交等待槽位空出。返回的 promise 以工作结果 resolve 或以抛出的错误 reject。槽位在 `finally` 中释放，失败不会泄露容量。

### FifoLane

默认 `Lane` 实现。构造时校验 `maxConcurrent ≥ 1` 且为整数；并发 1 复现严格串行执行，语义与旧 `SessionMutex` 相同。

### LaneRegistry

持有 `GatewayCore` 使用的三层：

| 字段 | 默认 `maxConcurrent` | 范围 |
| --- | --- | --- |
| `global` | 16 | 每个 run |
| `subagent` | 8 | 仅子代理触发的 run |
| `sessionLane(id)` | 1 | 单 session，懒创建 |

`releaseSessionLane(id)` 仅在 lane 空闲（active = 0、queued = 0）时返回 `true`。否则 lane 保留直到可以安全回收。`status()` 返回三层占用快照，供 `vole gateway status` 命令使用。

### runThroughLanes

按顺序组合三层：

```typescript
await runThroughLanes(
  registry,
  { sessionId: "agent:default:main", isSubagent: false },
  () => runtime.runTurn(req)
);
```

链路顺序为 `global → (subagent 适用时) → session → work`。Session lane 最内层；其槽位先于 subagent 与 global 释放，回压由内向外传播。

## 实现原则

### 为什么独立 package

Run 准入是 **调度关注点**，不是 runtime 关注点。独立后：

1. **`AgentRuntime` 不感知准入**：它接受 abort signal 并运行；不强制并发或 session 顺序。
2. **`GatewayCore` 是唯一调用方**：lane 链在唯一一处构造；adapter 无法绕开。
3. **可独立测试**：lane 行为确定性强，无需启动 runtime 即可单元测试。

### Per-Session 并发 1

Session 层默认 `maxConcurrent: 1`。这是旧进程内 `SessionMutex` 的严格泛化：相同的可观察行为，但可与其他层组合。

### 跨进程串行化

Lane 状态是进程内的。两个 `vole` 进程针对同一 session 各自维护自己的 session lane；跨进程写入顺序由跨进程文件锁负责（Phase 11 在 `packages/sessions` 交付该锁）。两层组合：lane 在一个 Node 进程内排序写入；文件锁跨进程排序写入。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package 清单 | 声明 lanes package、导出入口、构建脚本。 |
| `tsconfig.json` | TypeScript 配置 | 构建 lanes package（不依赖其他 workspace package）。 |
| `src/index.ts` | Lane 原语 | 所有导出：`Lane`、`LaneOccupancy`、`FifoLane`、`LaneRegistry`、`LaneRegistryStatus`、`LaneRegistryOptions`、`DEFAULT_LANE_CONCURRENCY`、`LaneChainOptions`、`runThroughLanes`。 |
| `src/index.test.ts` | Lane 测试 | 覆盖 FIFO 顺序、并发上限、成功 / 失败的槽位释放、registry session-lane 复用与回收、lane chain 组合，以及 Phase 11 §5 验收场景。 |

## 更新提醒

当目录结构或模块职责变化时更新本文件。

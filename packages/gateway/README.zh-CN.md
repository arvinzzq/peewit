# Gateway Package

English version: [README.md](./README.md)

## 架构概述

`@vole/gateway` 是 **每个 agent run 的唯一受理点**。它包含两层：

1. `SessionGateway` —— 来自 Phase 10 的进程内会话注册表：哪些 session 活跃、哪个 adapter 托管、该 adapter 具备什么能力。
2. `GatewayCore` —— Phase 11 扩展，在注册表之上加入 run 准入、取消与 status 报告。每个被接受的 run 都先穿过 `@vole/lanes` 提供的 global / subagent / per-session 三层 lane 链，再执行调用方的 run 函数。

```
apps/cli ──submit──▶
apps/web ──submit──▶  GatewayCore  ──runThroughLanes──▶  AgentRuntime.runTurn
scheduler ─────────▶       │
                           ├── SessionGateway registry（register、list、...）
                           ├── LaneRegistry（global / subagent / session）
                           └── activeRuns map（用于 cancel + status）
```

Gateway 不含 agent 逻辑，不存消息，不做策略决策。它是纯协调：哪些 session 存在、哪些 lane 准入 run、当前哪些 run 活跃。

## 核心概念

### GatewaySession

```typescript
interface GatewaySession {
  id: string;
  adapterName: string;           // "cli"、"web"、"background" 等
  capabilities: AdapterCapabilities;  // 来自 @vole/adapters
  registeredAt: string;
  lastActivityAt: string;        // 由 touch() 更新
}
```

### SessionGateway

Phase 10 的注册表，作为独立基类保留：

| 方法 | 描述 |
|---|---|
| `register(session)` | 记录新的活跃 session |
| `unregister(sessionId)` | session 结束时移除 |
| `touch(sessionId)` | 将 `lastActivityAt` 更新为当前时间（未知 session 时无操作） |
| `get(sessionId)` | 返回 session 记录或 `undefined` |
| `list()` | 返回所有活跃 session |
| `listByAdapter(adapterName)` | 返回特定 adapter 的 session |

仅在内存中；每次 adapter 启动时重新注册。

### GatewayCore

继承 `SessionGateway` 并加入 Phase 11 准入语义：

```typescript
interface RunRequest<TEvent = unknown> {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent?: boolean;
  run: (signal: AbortSignal) => AsyncIterable<TEvent>;
}

class GatewayCore extends SessionGateway {
  submit<TEvent>(req: RunRequest<TEvent>): AsyncIterable<TEvent>;
  cancel(runId: string): boolean;
  status(): GatewayStatus;
}
```

`submit` 接受调用方提供的 `run` 函数，把它穿过 lane 链，并按事件产生顺序 yield 出去。`cancel` 通过 `controller.abort()` 中止 run；run 函数被要求在安全检查点尊重该信号。`status()` 返回 lane 占用与活跃 run 的快照，供 `vole gateway status` 命令使用。

### 类型泛型

`GatewayCore` 与事件类型无关。`RunRequest<TEvent>` 是泛型，调用方可在不让 gateway 依赖 `@vole/core` 的前提下特化事件类型。CLI / Web adapter 用 `RuntimeEvent` 参数化；测试出于简洁使用 `string`。

## 实现原则

### 为什么 Gateway 拥有准入

Phase 10 之前每个进程一个 session 时单 `AgentRuntime` 够用。Vole 演进出四个只有集中式 gateway 才能解决的问题：

- 多个 adapter 需要访问同一 agent session，且不互相耦合。
- 并发必须有界：无上限的子代理 spawn 会损坏状态。
- Cancel 需要单一权威点知道该中断哪条 lane。
- Status（`vole gateway status`）需要单一读取实时占用的地方。

Phase 11 起 gateway 是 `AgentRuntime.runTurn` 的唯一合法调用方。

### 不直接依赖 @vole/core

Gateway 不 import `@vole/core`。调用方把 `AgentRuntime` 的构造与调用包装成 `run(signal) => AsyncIterable<events>` 回调。这种反转保持依赖图无环：gateway → lanes、gateway → adapters，但不存在 gateway → core。

### 取消语义

`cancel(runId)` 在找到匹配 run 并发出信号时返回 `true`。它不等待 run 实际停止 —— 由调用方决定何为安全停止点。若一个排队中的 run 在它的 lane 槽位开启前被取消，run 函数仍会启动但立即观察到 `signal.aborted === true`，被期望直接返回不做工作。

### AsyncEventQueue（内部）

内部 `AsyncEventQueue` 桥接基于 promise 的 lane-chained run 与基于迭代的调用方。生产者推入事件，消费者迭代；close 队列让迭代干净结束，fail 队列让下一次迭代抛错。不导出。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 gateway package，依赖 `@vole/adapters` 与 `@vole/lanes`。 |
| `tsconfig.json` | TypeScript 配置 | 使用对 adapters 与 lanes 的项目引用构建 gateway。 |
| `src/index.ts` | Gateway 原语 | 所有导出：`GatewaySession`、`SessionGateway`、`GatewayCore`、`RunRequest`、`RunHandle`、`GatewayStatus`、`GatewayCoreOptions`、`gatewayPackageName`。 |
| `src/index.test.ts` | Gateway 测试 | 覆盖 `SessionGateway` 注册表语义，以及 `GatewayCore` 事件流、lane 准入顺序、取消、status 快照、错误传播与子代理 lane 上限。 |

## 更新提醒

当目录结构或模块职责变化时更新本文件。

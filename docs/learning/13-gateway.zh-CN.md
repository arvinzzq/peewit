# 模块 12：@vole/gateway

状态：已完成
日期：2026-05-07

英文版：`13-gateway.md`

相关源码：`packages/gateway/src/index.ts`

## 0. 如何使用本文档

本文档属于学习指南第四阶段（扩展系统）。
请在 [12-adapters.zh-CN.md](./12-adapters.zh-CN.md) 之后阅读——`GatewaySession` 携带了
来自 adapters 包的 `AdapterCapabilities`。

**阅读前**：通读 `packages/gateway/src/index.ts`（49 行），只有一个类和一个接口。然后在
`apps/cli` 和 `apps/web` 中 grep `SessionGateway`，看看它如何被使用。

**聚焦问题**：
- `SessionGateway` 仅在内存中。进程重启后，所有已注册的 session 会发生什么？
- `touch()` 对未知 session ID 静默忽略。为什么这是正确的行为？
- CLI 和 Web 各自创建了自己的 `SessionGateway` 单例。它们能看到彼此的 session 吗？应该能吗？

**检查点**：能够解释 `SessionGateway` 解决了 `JsonlSessionStore` 解决不了的什么问题，以及为什么
gateway 在内存中而 sessions 在磁盘上，即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：把 gateway 想象成繁忙写字楼的前台。前台不保存永久员工档案（那是 HR 的工作——session store）。
它维护一块实时白板，记录现在楼里有谁、从哪层进来的、上次在走廊看到他是什么时候。有人离开，名字就擦掉。
白板只反映当下。

**技术总结**：`@vole/gateway` 提供 `SessionGateway`，一个跨 adapter 界面追踪当前活跃 session 的
内存注册表。每个条目是一条 `GatewaySession` 记录：session ID、adapter 名称、能力、注册时间和
最后活动时间戳。注册表支持 register、unregister、touch（更新活动时间）、get、list 和 listByAdapter。
它没有持久化——数据只存在于进程生命周期内。

## 2. 为什么这个模块存在

`JsonlSessionStore` 跨进程重启持久化对话历史，回答"session X 说了什么？"。Gateway 回答不同的问题：
"现在哪些 session 是活跃的，来自哪个界面？"

没有 gateway，就无法：
- 列出当前进程中所有打开的 CLI session
- 暴露显示活跃 web session 的 API endpoint
- 强制执行并发运行守卫（"session X 已经在运行，拒绝这次新的 turn"）
- 当多个 adapter 共存时将消息路由到正确界面

Gateway 是实时存在层；session store 是历史层。它们互补，有意分离。

## 3. 公开接口

```ts
interface GatewaySession {
  id: string;
  adapterName: string;           // "cli"、"web" 等
  capabilities: AdapterCapabilities;
  registeredAt: string;          // ISO 8601
  lastActivityAt: string;        // ISO 8601，由 touch() 更新
}

class SessionGateway {
  register(session: GatewaySession): void
  unregister(sessionId: string): void
  touch(sessionId: string): void         // 更新 lastActivityAt；对未知 ID 为空操作
  get(sessionId: string): GatewaySession | undefined
  list(): GatewaySession[]
  listByAdapter(adapterName: string): GatewaySession[]
}
```

## 4. 实现走读

### 内存 Map，无持久化

```ts
class SessionGateway {
  readonly #sessions = new Map<string, GatewaySession>();
}
```

就是一个私有的 `Map<string, GatewaySession>`。register 添加条目，unregister 删除，touch 用更新后的
`lastActivityAt` 替换值。进程重启清空一切——这是有意为之，因为"当前活跃"只对当前进程有意义。

### touch：不可变更新

```ts
touch(sessionId: string): void {
  const s = this.#sessions.get(sessionId);
  if (s !== undefined) {
    this.#sessions.set(sessionId, { ...s, lastActivityAt: new Date().toISOString() });
  }
}
```

`GatewaySession` 记录被替换而非原地修改。展开运算符创建带有更新时间戳的新对象，避免调用者持有旧记录
引用时的别名 bug。

`if (s !== undefined)` 守卫使 `touch` 对未知 ID 静默为空操作。替代方案——抛出异常——会要求每个调用者
防御性地处理过期 session ID，对进程内注册表来说不值得。

### 每个 adapter 一个单例，而非一个全局 gateway

CLI 和 Web 各创建模块级单例：

```ts
// apps/cli/src/index.ts
const cliGateway = new SessionGateway();

// apps/web/src/server.ts
const webGateway = new SessionGateway();
```

它们是独立实例（在独立进程中，或即使在同一进程中也由模块隔离）。CLI session 和 Web session 互不出现
在对方的注册表中。这是正确的：gateway 为一个 adapter 的协调需求追踪 session，而非跨进程存在。

### CLI 如何使用它

CLI 的 `ChatSession` 类（管理单个交互式聊天的 Ink 组件）在构造时注册自身，在清理时注销：

```ts
// session 开始时注册
const gatewaySession: GatewaySession = {
  id: this.#sessionId,
  adapterName: "cli",
  capabilities: CLI_CAPABILITIES,
  registeredAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString()
};
cliGateway.register(gatewaySession);

// 组件卸载时清理
this.#gateway?.unregister(this.#sessionId);
```

### Web 如何使用它

Web 服务器在 turn 开始时注册 session，并通过 REST endpoint 暴露实时列表：

```ts
// GET /api/gateway/sessions — 返回实时 session 列表
app.get("/api/gateway/sessions", (c) => {
  return c.json({ sessions: webGateway.list() });
});
```

## 5. OpenClaw 对齐

| OpenClaw | Vole | 说明 |
|---|---|---|
| 多入口协调的 session 注册表 | `SessionGateway` | 相同的内存 Map 方式 |
| 每个 adapter 的 session 隔离 | 每个 adapter 独立的 gateway 单例 | 相同模式 |
| 存在检测的活动时间戳 | `GatewaySession.lastActivityAt` + `touch()` | 相同概念 |
| Gateway sessions API endpoint | `GET /api/gateway/sessions` | 相同模式 |

## 6. 关键设计决策

**仅内存——有意不持久化**

Gateway 追踪存在，而非历史。已结束的 session 不再"存在"，不属于注册表。持久化注册表会增加过期条目
清理的复杂度（如果进程崩溃而从未注销怎么办？），而没有带来任何价值。session store 处理历史；gateway
处理活跃性。

**每个 adapter 独立单例，而非一个全局 gateway**

全局 gateway 需要所有 adapter 共享注册表，意味着要协调 session ID 命名空间和 adapter 标记。每个
adapter 独立单例更简单：每个 adapter 只注册自己的 session，只查询自己的注册表。`listByAdapter` 方法
适用于一个 adapter 托管多个命名子界面的情况。

**`touch` 对未知 ID 为空操作**

正常操作中，`touch` 在活跃 session 的 turn 期间调用。session 在 `touch` 调用前刚好被注销的竞争条件
不应该抛出异常——turn 无论如何都快结束了。对过期引用的正确响应是静默空操作。

**`GatewaySession` 携带能力，而非仅 ID**

在 session 记录中包含 `AdapterCapabilities` 允许任何收到 `GatewaySession` 的代码做出能力感知的决策
（例如"这个 session 能流式输出吗？"），而无需单独查找 adapter。能力在注册时设置，在 session 生命周期
内视为不可变。

## 7. 测试方式

测试在 `packages/gateway/src/index.test.ts` 中。所有测试都是同步内存操作——无文件系统、无异步：

- `register` / `get`：注册后 session 可检索
- `unregister`：移除 session；`get` 返回 `undefined`
- 未知 ID 的 `get`：返回 `undefined`
- `list`：返回所有已注册 session；无 session 时返回空数组
- `listByAdapter`：正确过滤；不匹配的 adapter 返回空数组
- `touch`：更新 `lastActivityAt`；未知 ID 为空操作（不抛出异常）

## 8. 洞察

**Gateway 和 session store 回答不同的问题。** `JsonlSessionStore.listMessages` 回答
"agent 在 session X 中说了什么？"。`SessionGateway.list()` 回答"现在这个进程中哪些 session 是活跃的？"。
这两个问题是正交的。一个 session 可以存在于 store 但不在 gateway 中（它已结束）；也可以存在于 gateway
但还没有已存储的消息（它刚启动）。

**Gateway 是并发运行守卫的正确位置。** 如果两个请求同时到达同一个 session ID，gateway 可以检测到：
`get(sessionId)` 返回一条 `lastActivityAt` 异常近期的记录。在 gateway 记录上加互斥锁或"运行中"标志
可以防止并发 agent 运行。目前 Vole 用 `@vole/sessions` 的 `SessionMutex` 来实现，但 gateway 才是
多 adapter 存在协调的自然位置。

**49 行——monorepo 中最小的包。** Gateway 只做一件事：在内存中追踪活跃 session。它的简洁是一个特性。
增加持久化、驱逐策略或 TTL 清理都属于扩展的 gateway 层，不属于这个包。

## 9. 复习问题

1. 进程重启后 `SessionGateway` 的内容会怎样？
   > 全部丢失。Gateway 是内存中的 `Map`——没有持久化。这是有意为之：gateway 追踪活跃性（现在谁
   > 是活跃的），而非历史（说了什么）。重启前结束的 session 不是"活跃的"，不应该出现。

2. CLI 和 Web 各自创建了 `SessionGateway` 单例。它们能看到彼此的 session 吗？
   > 不能。它们是独立实例。CLI session 注册在 `cliGateway` 中；Web session 注册在 `webGateway` 中。
   > 它们永远不共享状态。这是正确的：每个 adapter 独立协调自己的 session。

3. `touch("unknown_id")` 会发生什么？
   > 什么都不发生。`if (s !== undefined)` 守卫使它成为静默空操作。未知 ID 被忽略，不抛出异常。
   > 这处理了 session 在 `touch` 调用前刚好被注销的竞争条件。

4. `GatewaySession.capabilities` 包含什么，为什么存储在 gateway 记录上？
   > 包含拥有该 session 的 adapter 的 `AdapterCapabilities`：`streaming`、`approvalPrompts`、
   > `background`。存储在记录上意味着任何 `GatewaySession` 的消费者都可以做出能力感知的决策，
   > 而无需单独查找 adapter。能力在注册时固定，在 session 生命周期内不变。

5. `SessionGateway` 解决了 `JsonlSessionStore` 解决不了的什么问题？
   > `JsonlSessionStore` 是历史档案：它为每个 session 的每条消息和 trace 事件永久存储。如果不读取
   > 每个文件并从时间戳推断活动，它无法回答"现在哪些 session 是活跃的"。`SessionGateway` 维护一个
   > 带有 O(1) 查找的活跃 session 实时显式列表。两者互补：历史 vs. 存在。

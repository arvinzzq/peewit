# Channels Package

English version: [README.md](./README.md)

## 架构概览

`@vole/channels` 拥有 Vole 的 **入站界面层** —— 每个非 CLI、非 Web 的消息源（Telegram bot、邮箱、Slack 应用、webhook、未来的 SMS）都住在本 package 定义的 `Channel` 接口之后。

```
外部平台                                                         gateway
                 ┌───────────────────────────────┐
入站（轮询/      │  Channel.start(handler)       │  → gateway.submit({sessionKey:"channel:<id>:<thread>", run})
推送）           │      onMessage(msg)           │
                 │                               │
出站回复         │  Channel.send(to, message)    │  ← AgentRuntime 产出 assistant_message_created
                 └───────────────────────────────┘
```

Phase 15 Step 4（本次提交）交付接口 + 注册表 + 用于测试的确定性 `FakeChannel`。真实后端（Telegram、email）与 gateway 路由接线在 Phase 15b。

## 核心概念

### Channel

```ts
interface Channel {
  readonly id: string;
  readonly agentId: string;
  readonly kind: string;     // "telegram" | "email" | "fake" | 未来
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: ChannelAddress, message: OutboundMessage): Promise<void>;
}
```

一个 channel = 一个 agent 的一个外部界面。多个 channel 可绑定同一 `agentId`；一个 channel 不能服务多个 agent。

### InboundMessage / OutboundMessage

`InboundMessage` 是 gateway 看到的与平台无关的形态。`threadKey` 是平台特定的（Telegram chat id、email Message-ID 家族），供 `sessionKeyForInbound()` 使用。`OutboundMessage` 是薄薄的 body + 可选 `inReplyTo`；channel 添加平台特定的 header / framing。

### ChannelRegistry

进程内注册表。Adapter 在启动时为每个 channel 调用 `add()`，然后一次性调用 `startAll(handler)`。共享的 handler 通常包装 `GatewayCore.submit`，让所有入站消息加入同一条 lane 链。

### FakeChannel

供测试的参考实现。`injectInbound()` 模拟外部到达；`sent` 记录出站调用以便断言。Phase 15b 真实后端将在接口层面通过与 FakeChannel 相同的测试。

### sessionKeyForInbound

纯辅助函数，组合 `channel:<channelId>:<threadKey-or-externalUserId>` —— gateway 用此字符串作 `sessionKey`，自动获得 per-thread lane 串行化。

## 实现原则

### 为什么独立 package

Channel 携带外部信任边界（不可信用户、未知速率、混合编码）。把它们与 CLI 或 gateway 放在同一 package 会让网络 / 轮询代码渗入应保持进程内的层。切分保持 gateway 纯净（永不 import Telegram SDK），并让 channel 拥有自己的原生依赖需求。

### 无状态的 Channel，有状态的 Registry

每个 `Channel` 实例携带最小状态（running 标志、handler 引用）。所有跨 channel 协调 —— 并发入站消息排序、广播、关闭顺序 —— 住在注册表。这让单个 channel 实现保持小且聚焦于传输。

### 暂不 import gateway

本次提交刻意不从 `@vole/channels` import `@vole/gateway`。`InboundHandler` 接口让 adapter 在启动时把两者接线，不让 package 耦合。Phase 15b Step 7 将在 `apps/cli`（之后 `apps/web`）展示接线。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 `@vole/channels`，无 workspace 依赖。 |
| `tsconfig.json` | TypeScript 配置 | 构建 channels package。 |
| `src/index.ts` | Channel 原语 | 所有导出：`Channel`、`InboundMessage`、`OutboundMessage`、`ChannelAddress`、`InboundHandler`、`ChannelRegistry`、`ChannelRegistryError`、`FakeChannel`、`FakeChannelOptions`、`sessionKeyForInbound`、`channelsPackageName`。 |
| `src/index.test.ts` | Channels 测试 | 覆盖 FakeChannel 生命周期（send-before-start 拒绝、入站注入、send + stop）、ChannelRegistry（重复 id、startAll / stopAll、list 过滤、remove、handler 共享）以及 sessionKeyForInbound。 |

## 更新提醒

当目录结构或模块职责变化时更新本文件。

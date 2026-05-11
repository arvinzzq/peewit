# Channels

状态：计划中（Phase 15 Steps 4–7）
日期：2026-05-12

English version: [channels.md](./channels.md)

## 1. 目的

Channel 是任何把用户消息从本地 CLI / Web session 之外送达 Vole 的入站界面 —— Telegram、email、Slack、webhook，以及未来的 SMS / Discord 适配。Channels 层把"消息从哪来"与"哪个 agent 身份回答"解耦：每个 channel 绑定到唯一 `agentId`，每条入站消息变成通过 `GatewayCore` 提交的 `RunRequest`，gateway 的 lane 链让 channel 流量与 CLI、Web turn 一起串行化。

Phase 15 交付 channel 接口、注册表与生命周期（Step 4）。真实后端（Step 5 Telegram、Step 6 email）与 gateway 路由接线（Step 7）推迟到 Phase 15b，因为它们各自需要相当多的集成测试脚手架（mock Telegram server、内嵌 IMAP/SMTP harness），不该塞进基础 commit。

## 2. Channel 概念

`Channel` 是一个长生命周期的 adapter 对象，为一个 agent 拥有一个外部界面。它的生命周期：

```
construct(agentId, credentials)
  → start(handler)          // 开始接收入站消息
  → onMessage(msg) ...      // 每条入站到达，通过 handler 流入 gateway
  → send(to, message)       // 出站回复通过 channel 的传输回送
  → stop()                  // 优雅关闭
```

多个 channel 可绑定同一 agent（`agentId: "work"` 可同时有 Telegram bot 与邮箱）。一个 channel 不能服务多个 agent —— 那会让路由逻辑在 channel 注册表与 per-agent 身份层之间割裂。如果需要共享 bot，跑两个 channel 实例都指向同一 bot 账号。

## 3. Channel 接口

```ts
export interface InboundMessage {
  channelId: string;          // 对应 Channel.id
  externalUserId: string;     // 平台特定（Telegram user id、email From: 地址……）
  threadKey?: string;         // 平台特定的 thread / chat id；用于派生 session key
  body: string;
  receivedAt: string;
  attachments?: Array<{ kind: string; ref: string }>;  // Phase 16+ 预留
}

export interface OutboundMessage {
  body: string;
  inReplyTo?: string;         // 可选的原消息 id，用于线程化回复
}

export interface ChannelAddress {
  externalUserId: string;
  threadKey?: string;
}

export interface InboundHandler {
  onMessage(msg: InboundMessage): Promise<void>;
}

export interface Channel {
  readonly id: string;
  readonly agentId: string;
  readonly kind: "telegram" | "email" | "fake" | string;
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: ChannelAddress, message: OutboundMessage): Promise<void>;
}
```

`ChannelRegistry`（也由 `packages/channels` 导出）把 channel 接入 gateway。Adapter 在启动时添加 channel；注册表调用每个 channel 的 `start()`，并把 `onMessage` 回调转发到 gateway 作为 `sessionKey: "channel:<channelId>:<threadKey>"` 的 `RunRequest`。

## 4. 初始集成

Phase 15 Step 5 + 6 加入两个具体后端 —— 都推迟到 15b：

- **Telegram**（`packages/channels/telegram`）：长轮询 bot 客户端。每个 channel 实例对应一个 bot token。群聊与私聊都产出入站消息；per-user / per-chat 的 threadKey 让 session 不会把群聊与 1:1 对话混在一起。
- **Email**（`packages/channels/email`）：可配置间隔的 IMAP 入站、SMTP 出站。每个邮件 thread（Message-ID 家族）映射到单一 session —— 回复流回同一 `sessionKey`。

两个后端实现同一 `Channel` 接口，未来加新（Slack、Discord、webhook）无需动 gateway 或 agent runtime。

## 5. 路由

入站消息变成与 CLI / Web 同形态的 `RunRequest`。Gateway 像处理任何其他 run 一样把它穿过 global / subagent / session 三层 lane：

```
channel.onMessage(msg)
  → gateway.submit({
      runId: createRunId(),
      sessionKey: `channel:${channel.id}:${msg.threadKey ?? msg.externalUserId}`,
      agentId: channel.agentId,
      message: msg.body,
      run: (signal) => agentRuntime.runTurn({ sessionId: ..., message: msg.body, signal })
    })
  → 流事件，把 assistant 文本通过 channel.send(...) 路由回去
```

Session key 前缀 `channel:` 让 channel 驱动的 session 在 `vole sessions list` 中一眼可辨，且不与 CLI / Web 的 session id 冲突。Channel session 仍受 per-session lane 串行化保护：同一用户快速回复两次时，第二次排在第一次之后。

## 6. 隐私与信任边界

Channel 把外部数据带入 Vole，因此置于显式策略之后：

- Channel 绑定的 session 默认 **read-deny** 记忆文件（`MEMORY.md`、`USER.md`、daily notes）。Agent 身份通过 `agents/<id>/AGENTS.md` 拥有该策略；用户未显式授予记忆读权前，email 驱动的 run 不能读取 `MEMORY.md`。
- 所有出站 `channel.send` 调用经过与工具相同的 `PermissionPolicy` 闸门；"发邮件到任意地址"是一次工具调用，不是免费通行证。
- Channel 触发的 session 在 `vole sessions list` 中以 `channel:` 前缀显示，用户可按 channel 审计对话历史。
- 可选脱敏：gateway 可配置为在入站 channel 内容出现在 trace 事件前剥离特定模式（信用卡、SSN、API key）。列表由用户配置。

## 7. 参考

- [Phase 15 计划](../plans/phase-15-channels-and-multi-agent-identity.zh-CN.md)
- [Gateway](./gateway.zh-CN.md) —— channel 入站流入此处
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md) —— per-agent 身份目录
- [Permission System](./permission-system.zh-CN.md) —— 出站 send 闸门
- [OpenClaw 架构映射](./openclaw-architecture-map.zh-CN.md) —— OpenClaw 中的 channel 概念

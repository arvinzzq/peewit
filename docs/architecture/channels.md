# Channels

Status: Planned (Phase 15 Steps 4–7)
Date: 2026-05-12

Simplified Chinese version: [channels.zh-CN.md](./channels.zh-CN.md)

## 1. Purpose

A channel is any inbound surface that delivers user messages to Vole from outside the local CLI / Web session — Telegram, email, Slack, webhooks, future SMS / Discord adapters. The channels layer decouples *where* a message came from from *which agent identity* should answer it: each channel is bound to a single `agentId`, every inbound message becomes a `RunRequest` submitted through `GatewayCore`, and the gateway's lane chain serializes channel traffic alongside CLI and Web turns.

Phase 15 ships the channel interface, registry, and lifecycle (Step 4). Real backends (Telegram in Step 5, email in Step 6) and gateway routing wiring (Step 7) are deferred to Phase 15b because they each require substantial integration-test scaffolding (mock Telegram server, embedded IMAP/SMTP harness) that does not belong in the foundational commit.

## 2. Channel Concept

A `Channel` is a long-lived adapter object that owns one external surface for one agent. Its lifecycle:

```
construct(agentId, credentials)
  → start(handler)          // begin receiving inbound messages
  → onMessage(msg) ...      // each inbound arrival flows to the gateway via the handler
  → send(to, message)       // outbound replies route back through the channel's transport
  → stop()                  // graceful shutdown
```

Multiple channels can target the same agent (`agentId: "work"` can have a Telegram bot AND an email account). One channel cannot serve multiple agents — that splits routing logic uncomfortably across the channel registry vs. the per-agent identity layer. If you need a shared bot, run two channel instances both pointed at the same bot account.

## 3. Channel Interface

```ts
export interface InboundMessage {
  channelId: string;          // matches Channel.id
  externalUserId: string;     // platform-specific (Telegram user id, email From: address, …)
  threadKey?: string;         // platform-specific thread / chat id; used to derive session key
  body: string;
  receivedAt: string;
  attachments?: Array<{ kind: string; ref: string }>;  // reserved for Phase 16+
}

export interface OutboundMessage {
  body: string;
  inReplyTo?: string;         // optional original message id for threaded replies
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

The `ChannelRegistry` (also exported by `packages/channels`) wires channels into the gateway. Adapters add channels at startup; the registry calls `start()` on each and forwards `onMessage` callbacks into the gateway as `RunRequest`s with `sessionKey: "channel:<channelId>:<threadKey>"`.

## 4. Initial Integrations

Phase 15 Steps 5 + 6 add two concrete backends — both deferred to 15b:

- **Telegram** (`packages/channels/telegram`): long-polling bot client. One bot token per channel instance. Group chats and private chats both produce inbound messages; the per-user / per-chat threadKey scopes sessions so a group conversation does not merge into a 1:1 session.
- **Email** (`packages/channels/email`): IMAP fetcher on a configurable interval for inbound, SMTP for outbound. Each email thread (Message-ID family) maps to a single session — replies flow back into the same `sessionKey`.

Both backends speak the same `Channel` interface so future additions (Slack, Discord, webhooks) slot in without touching the gateway or the agent runtime.

## 5. Routing

Inbound messages turn into `RunRequest`s with the same shape CLI / Web already use. The gateway routes them through global / subagent / session lanes exactly like any other run:

```
channel.onMessage(msg)
  → gateway.submit({
      runId: createRunId(),
      sessionKey: `channel:${channel.id}:${msg.threadKey ?? msg.externalUserId}`,
      agentId: channel.agentId,
      message: msg.body,
      run: (signal) => agentRuntime.runTurn({ sessionId: ..., message: msg.body, signal })
    })
  → stream events, route assistant text back via channel.send(...)
```

The session key prefix `channel:` makes channel-driven sessions trivially distinguishable in `vole sessions list` and prevents collision with CLI / Web session ids. Channel sessions still benefit from per-session lane serialization: if the same user replies twice quickly, the second reply queues behind the first.

## 6. Privacy and Trust Boundary

Channels bring outside data into Vole, so they sit behind explicit policy:

- Channel-bound sessions default to **read-deny** for memory files (`MEMORY.md`, `USER.md`, daily notes). The agent identity owns this policy via `agents/<id>/AGENTS.md`; until a user explicitly grants memory read access, an email-driven run cannot exfiltrate `MEMORY.md`.
- All outbound `channel.send` calls pass through the same `PermissionPolicy` that gates tools; a "send email to arbitrary address" is a tool call, not a free pass.
- Channel-originated sessions appear in `vole sessions list` with the `channel:` prefix so the user can audit conversation history per channel.
- Optional redaction: the gateway can be configured to redact patterns (credit cards, SSNs, API keys) from inbound channel content before it appears in trace events. The list is user-configurable.

## 7. References

- [Phase 15 plan](../plans/phase-15-channels-and-multi-agent-identity.md)
- [Gateway](./gateway.md) — channel inbound flows here
- [Multi-Agent Runtime](./multi-agent-runtime.md) — per-agent identity directories
- [Permission System](./permission-system.md) — outbound send gating
- [OpenClaw Architecture Map](./openclaw-architecture-map.md) — channels concept in OpenClaw

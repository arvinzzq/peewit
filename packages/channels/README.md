# Channels Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/channels` owns the **inbound surface layer** of Vole — every non-CLI, non-Web message source (Telegram bots, email accounts, Slack apps, webhooks, future SMS) lives behind the `Channel` interface this package defines.

```
external platform                                              gateway
                 ┌───────────────────────────────┐
inbound (poll /  │  Channel.start(handler)       │  → gateway.submit({sessionKey:"channel:<id>:<thread>", run})
 push)           │      onMessage(msg)           │
                 │                               │
outbound replies │  Channel.send(to, message)    │  ← AgentRuntime emits assistant_message_created
                 └───────────────────────────────┘
```

Phase 15 Step 4 (this commit) ships the interface + registry + a deterministic `FakeChannel` for tests. Real backends (Telegram, email) and gateway routing wiring land in Phase 15b.

## Core Concepts

### Channel

```ts
interface Channel {
  readonly id: string;
  readonly agentId: string;
  readonly kind: string;     // "telegram" | "email" | "fake" | future
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: ChannelAddress, message: OutboundMessage): Promise<void>;
}
```

One channel = one external surface for one agent. Multiple channels can target the same `agentId`; a single channel cannot serve multiple agents.

### InboundMessage / OutboundMessage

`InboundMessage` is the platform-agnostic shape the gateway sees. `threadKey` is platform-specific (Telegram chat id, email Message-ID family) and feeds `sessionKeyForInbound()`. `OutboundMessage` is a thin body + optional `inReplyTo`; the channel adds platform-specific headers / framing.

### ChannelRegistry

In-process registry. The adapter calls `add()` for each channel at startup, then `startAll(handler)` once. The shared handler typically wraps `GatewayCore.submit` so all inbound messages join the same lane chain.

### FakeChannel

Reference implementation for tests. `injectInbound()` simulates external arrivals; `sent` records outbound calls for assertions. Real Phase 15b backends will pass the same tests as FakeChannel at the interface level.

### sessionKeyForInbound

Pure helper that composes `channel:<channelId>:<threadKey-or-externalUserId>` — the gateway uses this string as `sessionKey` so per-thread lane serialization works automatically.

## Implementation Principles

### Why a Separate Package

Channels carry external trust boundaries (untrusted users, unknown rate, mixed encoding). Putting them in the same package as the CLI or the gateway would bleed network / polling code into layers that should stay in-process. Splitting them keeps the gateway pure (it never imports a Telegram SDK) and lets channels grow their own native-dep needs.

### Stateless Channels, Stateful Registry

Each `Channel` instance carries minimal state (running flag, handler reference). All cross-channel coordination — concurrent inbound message ordering, broadcast, shutdown sequencing — lives on the registry. This keeps individual channel implementations small and focused on the transport.

### No Gateway Import Yet

This commit deliberately does not import `@vole/gateway` from `@vole/channels`. The `InboundHandler` interface lets adapters wire the two together at startup without coupling the packages. Phase 15b's Step 7 will demonstrate the wiring in `apps/cli` (and later `apps/web`).

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares `@vole/channels` with no workspace dependencies. |
| `tsconfig.json` | TypeScript config | Builds the channels package. |
| `src/index.ts` | Channel primitives | All exports: `Channel`, `InboundMessage`, `OutboundMessage`, `ChannelAddress`, `InboundHandler`, `ChannelRegistry`, `ChannelRegistryError`, `FakeChannel`, `FakeChannelOptions`, `sessionKeyForInbound`, `channelsPackageName`. |
| `src/index.test.ts` | Channels tests | Covers FakeChannel lifecycle (send-before-start rejection, inbound injection, send + stop), ChannelRegistry (duplicate id, startAll / stopAll, list filters, remove, handler sharing), and sessionKeyForInbound. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

# Channels Agent Guide

## Responsibility

Owns the inbound-surface layer: defines the `Channel` interface, holds a `ChannelRegistry` of running channels for a process, and ships a `FakeChannel` for tests. Backends (Telegram, email) and gateway routing wiring land in Phase 15b. Outbound `send` is part of the Channel contract; the registry never reaches into individual channels to invoke transport code.

## When Files Change

Update README and AGENTS when the interface, registry semantics, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change. Heading parity between EN and zh-CN must hold for docs:check.

## Testing

Tests must cover: FakeChannel lifecycle (send-before-start rejection, inbound injection via handler, send + stop), ChannelRegistry (duplicate id rejection, startAll / stopAll, list filters by agentId and kind, remove, handler sharing across channels), sessionKeyForInbound (threadKey present + threadKey absent). Real backends in 15b are required to pass the same suite via a shared conformance test once added.

## Boundaries

Do not import `@vole/gateway`, `@vole/core`, or any runtime layer in `src/index.ts`. The `InboundHandler` callback is the seam: adapters wire `channel.start(handler)` to a function that calls `gateway.submit` without channels depending on the gateway package.

Do not perform any tool-style work here. Permission decisions, agent-side reads of MEMORY.md, and tool execution stay in `@vole/permissions`, `@vole/memory`, and `@vole/tools` respectively. Channels carry messages; they do not interpret them.

Backend dependencies (telegram-bot-api, IMAP/SMTP clients) belong in sub-packages or future top-level packages such as `@vole/channels-telegram` / `@vole/channels-email` — keep `@vole/channels` itself dependency-free so it stays trivially testable.

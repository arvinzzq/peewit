# Phase 15: Channels and Multi-Agent Identity

Status: Planned
Date: 2026-05-11

Simplified Chinese version: [phase-15-channels-and-multi-agent-identity.zh-CN.md](./phase-15-channels-and-multi-agent-identity.zh-CN.md)

## 1. Purpose

Phase 15 closes two OpenClaw-alignment gaps left explicit in earlier roadmap mappings: independent multi-agent identity, and real channel integrations such as Telegram and email. These are the features that move Vole from "a CLI tool with one personality" to "a personal agent platform that runs alongside you across surfaces."

Phase 15 depends on Phase 11 (gateway routing) and Phase 14 (SQLite scale for many concurrent sessions across agents and channels).

## 2. Scope

This phase includes:

- `agents/` directory convention: each independent agent lives at `agents/<agentId>/` and owns its own `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `IDENTITY.md`, `TOOLS.md`, `skills/`, and credentials.
- `agents.list[]` and `agents.defaults` config fields; the gateway resolves `agentId` for every run request and loads identity from `agents/<agentId>/`.
- CLI: `vole agents list / create <id> / switch <id> / remove <id>`.
- `packages/channels`: new package with the `Channel` interface, registry, and lifecycle management.
- Two initial channel backends in `packages/channels/telegram` and `packages/channels/email`.
- Telegram backend using long polling; bound to an agent via config.
- Email backend with IMAP inbound and SMTP outbound; bound to an agent via config.
- Channel session isolation: each channel-originated conversation is a separate session under the target agent; channels never read MEMORY.md by default.
- `vole channel add / list / remove / test` CLI commands.

This phase does not include:

- Slack, Discord, WhatsApp, or generic webhook channels (Phase 17+).
- Cross-agent invocation (ACP runtime, Phase 17+).
- Multi-tenant isolation for hosted deployment.
- Per-agent process or container isolation (Phase 16 handles sandboxing at the tool layer).

## 3. Architecture Summary

### Multi-Agent Identity Layout

Each agent has its own workspace subtree:

```text
agents/
  work/
    AGENTS.md
    SOUL.md
    USER.md
    MEMORY.md
    IDENTITY.md
    TOOLS.md
    skills/
    .credentials/
  personal/
    ...
```

The gateway resolves identity once per run: given an `agentId`, it builds the `ContextAssembler` from the matching subtree. The bare `vole chat` continues to work and routes to the `default` agent.

Auth resolution honors per-agent credentials first, falling back to global `.env` / config. This lets the `work` agent use a company API key while `personal` uses a personal key.

### Channel Abstraction

```ts
interface Channel {
  id: string;
  agentId: string;
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: ChannelAddress, message: OutboundMessage): Promise<void>;
}

interface InboundHandler {
  onMessage(msg: InboundMessage): Promise<void>;
}
```

Inbound messages flow into `GatewayCore.submit({ sessionKey, agentId, message, channelMetadata })`. The gateway picks the right session lane and runs as usual. Outbound messages route back through the originating channel using metadata captured at intake.

### Initial Channel Integrations

- **Telegram**: long-polling bot client (`node-telegram-bot-api`). One channel per bot token, bound to one agent. Group chats supported; per-user session keying.
- **Email**: IMAP fetcher polling at a configurable interval; SMTP outbound. Each email thread maps to a session keyed on the thread Message-ID family.

Both backends speak the same `Channel` interface so future backends slot in without core changes.

### Privacy and Routing

Channel safety rules:

- A channel cannot read MEMORY.md, USER.md, or daily memory files unless the user explicitly grants the agent that channel binds to.
- All outbound messages from channel-originated sessions pass through the existing permission policy.
- Channel-originated sessions are visible in `vole sessions list` with a `channel:` prefix in the session key, so users can audit history.
- The gateway redacts inbound channel content before it appears in trace events when the message contains plausibly sensitive patterns (configurable redaction list).

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `multi-agent-runtime.md` update + zh-CN, new `channels.md` + zh-CN, roadmap update — docs:check must pass.
2. **feat(config,workspace)**: `agents/<id>/` directory layout; `agents.list[]` and `agents.defaults` config; per-agent identity loader; tests.
3. **feat(cli)**: `vole agents list / create / switch / remove` commands.
4. **feat(channels)**: `packages/channels` skeleton with `Channel` interface, registry, and lifecycle; tests with a fake channel.
5. **feat(channels)**: Telegram backend; integration test with a local mock server.
6. **feat(channels)**: Email backend; integration test against an embedded IMAP / SMTP test harness.
7. **feat(gateway,cli)**: gateway channel routing; `vole channel add / list / remove / test` commands.
8. **docs**: mark Phase 15 complete.

## 5. Acceptance Criteria

- `pnpm run check` and `pnpm run check:bundle` pass at every commit.
- Two configured agents have entirely separate MEMORY.md; a fact added in one is not visible in the other.
- `vole agents switch personal` reroutes subsequent CLI runs to the `personal` agent identity.
- A Telegram message arriving at the configured bot is processed by the bound agent end-to-end (covered by an integration test using a mock Telegram server).
- An IMAP-delivered email is processed by the bound agent and produces a session under the correct `agentId`; an SMTP reply is sent (covered by an integration test with an embedded mail server).
- A channel-originated session cannot read MEMORY.md unless explicitly granted; permission denial is logged.
- `vole channel test telegram@work` round-trips a synthetic message and prints the response.

## 6. Non-Goals

- No Slack, Discord, WhatsApp, or webhook channels.
- No cross-agent direct invocation.
- No hosted multi-tenant deployment.
- No agent process isolation.
- No automatic credential rotation.

## 7. Related Documents

- [Phase 11 Gateway and Lanes](./phase-11-gateway-and-lanes.md)
- [Phase 14 SQLite Storage Unification](./phase-14-sqlite-storage-unification.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)
- [Roadmap](../roadmap/overview.md)

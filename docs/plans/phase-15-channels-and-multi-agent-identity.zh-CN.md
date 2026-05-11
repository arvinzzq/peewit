# Phase 15：Channels 与多 Agent 身份

状态：部分（Step 1、2、3、4、7 已交付；Step 5、6 推迟 —— Telegram 与 Email 后端需要外部基础设施）
日期：2026-05-12

English version: [phase-15-channels-and-multi-agent-identity.md](./phase-15-channels-and-multi-agent-identity.md)

## 进度

状态：部分 —— per-agent 身份、agents CLI、channel↔submitter 桥都已交付。真实的 Telegram / Email 后端仍需外部基础设施（bot token、IMAP/SMTP 测试 harness），保持推迟。

已完成提交：

- [x] Step 1：docs(arch) multi-agent-runtime 的 Phase 15 提示 + 新 `channels.md` — `2d9365f`
- [x] Step 2（15b）：feat(config) `agents/<id>/` 身份加载器（`isValidAgentId`、`listAgentDirectories`、`resolveActiveAgentId`、`loadAgentIdentity`、`createAgentDirectory`、`setActiveAgentId`、`archiveAgentDirectory`）+ `agents.default` 配置 + `VOLE_AGENT` 环境变量 — `0e46b19`
- [x] Step 3（15b）：feat(cli) `vole agents list / create / switch / remove --confirm` — `0e46b19`
- [x] Step 4：feat(channels) `@vole/channels` package，含 `Channel`、`ChannelRegistry`、`FakeChannel`、`sessionKeyForInbound` — `567b7cb`
- [x] Step 7（15b）：feat(channels) `createGatewayInboundHandler` + `bridgeRegistryToSubmitter` —— adapter 提供的 submitter 接收 sessionKey、agentId、body、channelMetadata，让 channels 保持与 gateway 解耦 — `0e46b19`
- [x] Step 8：docs 标 Phase 15 部分 + roadmap 更新 — （本次提交）

仍推迟（外部基础设施）：

- [ ] Step 5：Telegram 后端（`@vole/channels-telegram` 或子路径）。需要长轮询 bot 客户端 + mock-server 集成测试 harness。
- [ ] Step 6：Email 后端。需要 IMAP/SMTP 客户端 + 内嵌邮件测试 harness。

它们落地后，channel adapter 把它们注册到 `ChannelRegistry` 并传给现有的 `bridgeRegistryToSubmitter` 即可 —— 无需再做架构变更。

## 1. 目的

Phase 15 关闭早期 roadmap 映射中明确列出的两个 OpenClaw 对齐缺口：独立的多 agent 身份，以及 Telegram、Email 等真实 channel 集成。这些是把 Vole 从"具有单一人格的 CLI 工具"推进到"在多个界面陪伴你的个人代理平台"的关键能力。

Phase 15 依赖 Phase 11（gateway 路由）与 Phase 14（SQLite 在多 agent、多 channel 的并发 session 下的承载力）。

## 2. 范围

本 phase 包含：

- `agents/` 目录约定：每个独立 agent 位于 `agents/<agentId>/`，拥有自己的 `AGENTS.md`、`SOUL.md`、`USER.md`、`MEMORY.md`、`IDENTITY.md`、`TOOLS.md`、`skills/` 与凭证。
- 配置字段 `agents.list[]` 与 `agents.defaults`；gateway 为每个 run request 解析 `agentId` 并从 `agents/<agentId>/` 加载身份。
- CLI：`vole agents list / create <id> / switch <id> / remove <id>`。
- `packages/channels`：新 package，含 `Channel` 接口、注册表、生命周期管理。
- 两个初始 channel 后端：`packages/channels/telegram` 与 `packages/channels/email`。
- Telegram 后端用长轮询；通过配置绑定到一个 agent。
- Email 后端：IMAP 入站、SMTP 出站；通过配置绑定到一个 agent。
- Channel session 隔离：每个 channel 触发的对话是其目标 agent 下的独立 session；channel 默认不读 MEMORY.md。
- `vole channel add / list / remove / test` CLI 命令。

本 phase 不包含：

- Slack、Discord、WhatsApp 或通用 webhook channel（Phase 17+）。
- 跨 agent 调用（ACP runtime，Phase 17+）。
- 托管多租户隔离。
- 每个 agent 的进程或容器隔离（Phase 16 在工具层处理沙箱）。

## 3. 架构摘要

### 多 Agent 身份目录结构

每个 agent 拥有自己的 workspace 子树：

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

Gateway 每次 run 解析身份一次：给定 `agentId`，从匹配的子树构造 `ContextAssembler`。裸 `vole chat` 仍可用，并路由到 `default` agent。

Auth 解析优先使用 per-agent 凭证，回退到全局 `.env` / config。这允许 `work` agent 用公司 API key，`personal` agent 用个人 key。

### Channel 抽象

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

入站消息进入 `GatewayCore.submit({ sessionKey, agentId, message, channelMetadata })`。Gateway 选对应的 session lane 并照常运行。出站消息按 intake 时捕获的元数据通过原 channel 回送。

### 初始 channel 集成

- **Telegram**：长轮询 bot 客户端（`node-telegram-bot-api`）。一个 bot token 对应一个 channel，绑定一个 agent。支持群聊；按用户分配 session key。
- **Email**：可配置间隔的 IMAP fetcher；SMTP 出站。每个邮件 thread 映射到一个 session，key 由 thread Message-ID 家族派生。

两个后端实现同一 `Channel` 接口，将来加新 channel 不动 core。

### 隐私与路由

Channel 安全规则：

- Channel 不能读 MEMORY.md、USER.md 或每日 memory 文件，除非用户显式授权其绑定的 agent。
- 所有 channel 触发 session 的出站消息都经过现有 permission policy。
- Channel 触发的 session 在 `vole sessions list` 中以 `channel:` 前缀显示，方便用户审计历史。
- 当入站 channel 内容包含疑似敏感模式时，gateway 在 trace 事件中按可配置 redaction 列表打码。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`multi-agent-runtime.md` 更新 + zh-CN、新 `channels.md` + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **feat(config,workspace)**：`agents/<id>/` 目录布局；`agents.list[]` 与 `agents.defaults` 配置；per-agent 身份加载器；测试。
3. **feat(cli)**：`vole agents list / create / switch / remove` 命令。
4. **feat(channels)**：`packages/channels` 骨架，含 `Channel` 接口、注册表、生命周期；用 fake channel 测试。
5. **feat(channels)**：Telegram 后端；用本地 mock server 做集成测试。
6. **feat(channels)**：Email 后端；用内嵌 IMAP / SMTP 测试 harness 做集成测试。
7. **feat(gateway,cli)**：gateway channel 路由；`vole channel add / list / remove / test` 命令。
8. **docs**：标记 Phase 15 完成。

## 5. 验收标准

- 每次提交都通过 `pnpm run check` 与 `pnpm run check:bundle`。
- 配置两个 agent，各自的 MEMORY.md 完全分离；在一个 agent 加的事实在另一个不可见。
- `vole agents switch personal` 让后续 CLI 运行路由到 `personal` agent 身份。
- 配置的 Telegram bot 收到消息后由绑定 agent 端到端处理（用 mock Telegram server 的集成测试覆盖）。
- IMAP 投递的邮件由绑定 agent 处理并在对应 `agentId` 下产生 session；SMTP 回复被发送（用内嵌邮件 server 的集成测试覆盖）。
- Channel 触发的 session 默认无法读 MEMORY.md（除非显式授权）；权限拒绝被记录。
- `vole channel test telegram@work` 往返一条合成消息并打印响应。

## 6. 非目标

- 不做 Slack、Discord、WhatsApp 或 webhook channel。
- 不做跨 agent 直接调用。
- 不做托管多租户部署。
- 不做 agent 进程隔离。
- 不做自动凭证轮换。

## 7. 相关文档

- [Phase 11 Gateway 与 Lane 基础设施](./phase-11-gateway-and-lanes.zh-CN.md)
- [Phase 14 SQLite 存储统一升级](./phase-14-sqlite-storage-unification.zh-CN.md)
- [Multi-Agent Runtime](../architecture/multi-agent-runtime.zh-CN.md)
- [OpenClaw 架构映射](../architecture/openclaw-architecture-map.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

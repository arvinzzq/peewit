# OpenClaw Architecture Map

状态：草案
日期：2026-05-02

English version: [openclaw-architecture-map.md](./openclaw-architecture-map.md)

## 1. 目的

Peewit 的目标是从 0 到 1 实现一个 OpenClaw-like 的个人通用 Agent 系统。

本文档把 OpenClaw 概念映射到 Peewit phases，让项目可以有意识地朝这个目标成长，同时不让 MVP 过载。

核心规则：

OpenClaw 是 primary architecture reference。Peewit 以分阶段、可测试的增量实现它的核心思想。

实现研究笔记：[OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)

兼容性决策：[0002：OpenClaw-Aligned, Not Identical](../decisions/0002-openclaw-aligned-not-identical.zh-CN.md)

## 2. 映射摘要

| OpenClaw Concept | Peewit Plan | Phase |
| --- | --- | --- |
| Agent workspace | 包含 prompt、memory、skill 和 config files 的本地 Peewit workspace | Phase 0-1 |
| `AGENTS.md` | Project 和 agent operating rules | Phase 0-1 |
| `SOUL.md` | Agent identity、values、tone 和 boundaries | Phase 1-2 |
| `USER.md` | User preferences 和 durable user context | Phase 5 |
| `MEMORY.md` | Curated long-term memory | Phase 5 |
| `memory/YYYY-MM-DD.md` | Daily notes 和 recent observations | Phase 5 |
| `TOOLS.md` | Environment 和 tool notes | Phase 5-6 |
| Skills | 先做本地 `SKILL.md` system，后做 plugin ecosystem | Phase 3、Phase 9 |
| Tools | 先做 file、shell、web tools；后续增加更多工具 | Phase 2+ |
| Permissions | Risk-based allow/ask/deny/block policy | Phase 2 |
| Session startup loading | 受控 prompt 和 memory loading order | Phase 1-5 |
| Gateway / multi-entry | 带 adapters 的共享 Agent Core | Phase 6-7 |
| Channels | Messaging 和 external entry adapters | Phase 7+ |
| Heartbeat / background automation | Scheduler、daemon、event triggers | Phase 8 |
| Memory search | Durable memory 和 local knowledge 的搜索 | Phase 5+ |
| Dreaming / memory promotion | 从 short-term signals 到 durable memory 的可审查 promotion | Phase 8+ |
| Multi-agent | 多 agents，具备独立 workspaces 和 permissions | Phase 10 |
| Remote/local nodes | Multi-node tool execution | Phase 10 |
| Security around workspace files | Permission checks、redaction、后续 drift detection | Phase 2+ |

## 3. Agent Workspace

OpenClaw 使用 agent workspace 作为 identity、memory 和 operational context 的可见 home。

Peewit 应实现 workspace model，包含：

- Prompt files
- Memory files
- Project-local skills
- Configuration
- Session and trace references
- 未来 plugin metadata

MVP 应从小结构开始：

```text
peewit.config.json
AGENTS.md
skills/
docs/
```

未来 workspace 形态：

```text
AGENTS.md
SOUL.md
USER.md
MEMORY.md
TOOLS.md
memory/
  YYYY-MM-DD.md
skills/
peewit.config.json
```

## 4. Workspace Prompt Files

Peewit 应支持 OpenClaw-like prompt files，并带有明确 scope 和 safety。

| File | Responsibility | Write Policy |
| --- | --- | --- |
| `AGENTS.md` | Operating rules 和 project instructions | User/project edited |
| `SOUL.md` | Agent identity、values、tone、boundaries | Read-only by default |
| `USER.md` | User preferences 和 personal context | User-approved writes only |
| `MEMORY.md` | Curated durable memory | User-approved writes only |
| `TOOLS.md` | Environment 和 tool notes | User/project edited |

Prompt files 应通过 context assembly pipeline 加载，而不是临时随意读取文件。

## 5. Memory Layers

Peewit 应镜像 OpenClaw 的 plain-file memory 方向，但要谨慎分阶段。

MVP：

- Active context
- 通过 session storage 实现 session memory
- Trace history

后续：

- Daily notes
- `MEMORY.md`
- Memory search
- Memory promotion
- Reviewable memory updates

任何 long-term memory file 都不应被 Agent 静默更新。

## 6. Skills and Plugins

OpenClaw 的 skill/plugin 方向是扩展性的核心。

Peewit 应实现：

- Phase 3：本地 `SKILL.md` skill loading
- Phase 3：内置 skills，例如 `research`、`project-inspector`、`task-planner`、`docs-writer` 和 `safe-shell`
- Phase 9：可安装 plugins 和 skill ecosystem
- Phase 9：plugin capabilities 的 permission declarations

Skills 应指导行为。Plugins 后续可以贡献 tools、prompts 或 adapters，但只能通过受权限控制的 interfaces。

## 7. Tools and Permissions

OpenClaw-like agents 强大是因为它们可以行动。Peewit 应从一开始就让行动安全。

MVP tools：

- File read/list/write
- Shell
- Web search
- Web page reading

MVP permission model：

- Low
- Medium
- High
- Blocked

每个 tool call 都应产生 trace，并经过 permission policy。

## 8. Session Startup Loading

OpenClaw-style systems 依赖 session start 时读取 workspace context。

Peewit 应分阶段实现 startup loading。

MVP startup：

```text
Base system instructions
  -> Configuration
  -> Session resume context
  -> Selected skills
```

OpenClaw-like target startup：

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Recent daily notes, if enabled
  -> Session resume context
  -> Selected skills
  -> Tool definitions
```

每增加一个 source，都应该有测试并在 trace 中可见。

## 9. Gateway and Multi-Entry

OpenClaw 的更大形态包含 gateways 和多个用户 surfaces。

Peewit 应通过 adapters 达成这一点：

- CLI first
- Web UI
- Desktop app
- Messaging platforms
- Background automation

Agent Core 应保持共享。Entry adapters 不应重新实现 core behavior。

## 10. Channels

Channels 延后到 Web UI 和 adapter boundaries 稳定之后。

未来 channels 可以包括：

- Telegram
- Slack
- Discord
- Email
- Local desktop notifications

Channels 需要更严格的 privacy 和 permission rules，因为 Agent 可能在 public 或 semi-public spaces 中发言。

## 11. Heartbeat and Background Automation

OpenClaw-style long-running agents 需要 background behavior。

Peewit 后续应通过以下方式实现：

- Scheduler
- Daemon mode
- Task queue
- Event triggers
- Background traces
- Pending risky actions 的 approval handling

MVP 不应包含 autonomous background work。

## 12. Multi-Agent and Nodes

Multi-agent 和 multi-node architecture 应属于后期阶段。

未来目标：

- Multiple agents
- Separate workspaces
- Separate `SOUL.md` 和 memory files
- Agent-specific tools and permissions
- Local and remote tool nodes
- Parent/child trace linkage

这不应在 core loop、permissions、sessions、memory 和 adapters 稳定前实现。

## 13. Security Risks to Track

OpenClaw-like architecture 引入特定风险：

- Workspace files 中的 prompt injection
- 对 `SOUL.md` 的恶意编辑
- Memory poisoning
- 通过 memory 或 trace 泄露 secret
- Dangerous tool invocation
- Plugin supply-chain risk
- Channel privacy mistakes
- Background automation 在错误时间运行

Peewit 应把这些视为设计要求，而不是事后补丁。

## 14. 测试要求

OpenClaw-like features 需要安全导向测试。

必需测试领域：

- Workspace file loading order
- Missing or malformed workspace files
- Read-only identity files
- Memory write approval
- Tool permission enforcement
- Workspace file reads 的 trace visibility
- Secret redaction
- Prompt injection regression tests
- Adapter-specific privacy behavior
- Background task permission handling

每个加入 Peewit 的 OpenClaw concept 都应带着测试一起到来。

## 15. 验收标准

这份 map 成功标准：

- OpenClaw 被清楚记录为 primary reference。
- 每个主要 OpenClaw concept 都有 Peewit phase。
- MVP 范围保持小，但指向完整 OpenClaw-like target。
- Memory、identity、tools、permissions、gateway、channels 和 background automation 都被分阶段安排。
- Safety 和 testing requirements 在实现前已记录。

## 16. 来源

- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Default AGENTS.md](https://docs.openclaw.ai/reference/AGENTS.default)
- [OpenClaw SOUL.md Template](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)

## 17. 相关文档

- [Reference Systems](./reference-systems.zh-CN.md)
- [Memory System](./memory-system.zh-CN.md)
- [Workspace Files](./workspace-files.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Skill System](./skill-system.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

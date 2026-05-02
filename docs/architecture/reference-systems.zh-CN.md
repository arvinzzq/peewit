# Reference Systems

状态：草案
日期：2026-05-02

English version: [reference-systems.md](./reference-systems.md)

## 1. 目的

ArvinClaw 应该学习已有 Agent 系统，但不能盲目复制。

OpenClaw 是 primary reference system，因为 ArvinClaw 的目标就是从 0 到 1 实现一个 OpenClaw-like 的个人通用 Agent。

Claude Code 是 secondary reference system。它对 CLI 工作流、project memory、permissions、hooks、subagents 和 developer-agent 体验等工程实践很有帮助。

参考优先级：

- Primary：OpenClaw
- Secondary：Claude Code

核心规则：

有意识地实现 OpenClaw-like 架构，同时使用 Claude Code 强化开发者工作流和工程纪律。

## 2. 从 OpenClaw 学什么

OpenClaw 有用，因为它展示了个人 Agent 如何通过 agent workspace 维护 identity、memory、tools 和 long-running behavior。

ArvinClaw 应研究这些 OpenClaw 思路：

- `SOUL.md`、`USER.md`、`MEMORY.md`、`AGENTS.md` 和 `TOOLS.md` 等 workspace files
- `memory/YYYY-MM-DD.md` 等 daily memory files
- File-based memory 作为 visible source of truth
- Session startup context loading
- 通过 `SOUL.md` 表达 personal identity 和 tone
- 通过 `USER.md` 表达 user context
- 通过 `MEMORY.md` 表达 long-term memory
- Channels 和 multi-entry interaction
- 多 surfaces 和 agents 的 gateway direction
- Background tasks 和 heartbeat-style automation
- Multi-agent 和 multi-workspace direction

这些想法定义了 ArvinClaw 的长期形态。

详细 OpenClaw 映射：[OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md)

实现研究笔记：[OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)

## 3. 从 Claude Code 学什么

Claude Code 有用，因为它展示了 Agent 如何深入代码库工作，同时让用户控制和项目约定保持可见。

ArvinClaw 应研究这些 Claude Code 思路：

- CLI-first developer workflow
- 通过 `CLAUDE.md` 实现 project memory
- User 和 project settings hierarchy
- Permission allow/deny configuration
- 围绕 tool use 和 lifecycle events 的 hooks
- 拥有独立 context windows 和 tool permissions 的 subagents
- Custom slash commands
- 随时间扩展到 terminal、IDE、desktop 和 web 的 multi-surface usage

这些想法尤其适用于 ArvinClaw 早期 CLI、developer-agent 和 engineering-quality 阶段。

## 4. 对比

| Area | Claude Code Reference | OpenClaw Reference | ArvinClaw Direction |
| --- | --- | --- | --- |
| First interface | CLI developer workflow | Messaging and personal assistant surfaces | CLI first, Web UI later, more adapters over time |
| Project instructions | `CLAUDE.md` | `AGENTS.md` and workspace files | Start with `AGENTS.md`-style instructions, later support more workspace files |
| Identity | Less central, task-oriented | `SOUL.md` and `IDENTITY.md` are central | Support `SOUL.md` as read-only prompt identity after prompt safety is clear |
| User context | Memory files and settings | `USER.md` | Design `USER.md`, defer writes until privacy policy is clear |
| Memory | Hierarchical memory and auto memory concepts | `MEMORY.md`, daily notes, memory tools | MVP session memory; long-term memory deferred with explicit policy |
| Tools | Codebase tools, shell, file edits, MCP | Skills, local tools, channels, plugins | File/shell/web tools first; plugin ecosystem later |
| Hooks | Tool and lifecycle hooks | Hooks and workspace behavior | Defer hooks until tool and permission systems are stable |
| Subagents | First-class subagents with separate context and tool access | Multi-agent workspaces | Defer multi-agent until core loop and adapter boundary are stable |
| Permissions | Settings-based allow/deny and tool permissions | Workspace and tool safety model | Risk-based permission system from MVP |

## 5. Prompt and Workspace File Plan

ArvinClaw 应从 OpenClaw 的 workspace model 出发，并用 Claude Code 的工程实践补强。

建议 prompt files：

- `AGENTS.md`：operating rules、project instructions 和 development conventions。
- `SOUL.md`：Agent identity、values、tone 和 boundaries。
- `USER.md`：User context、preferences 和 privacy boundaries。
- `MEMORY.md`：Curated long-term memory。
- `memory/YYYY-MM-DD.md`：Daily notes 和 recent observations。
- `TOOLS.md`：Environment and tool notes。

MVP 不应自动加载所有这些文件。相反：

- 从 base system instructions、configuration、session storage 和 skills 开始。
- 尽早加入 `AGENTS.md` 或 project instruction loading。
- 在 redaction 和 trace rules 存在后，把 `SOUL.md` 作为 read-only prompt identity 加入。
- 将 `USER.md`、`MEMORY.md` 和 daily memory writes 延后，直到 user approval 和 permission policies 设计清楚。

## 6. Configuration Plan

Claude Code 的 settings hierarchy 是有用参考。

ArvinClaw 应支持：

- User config：`~/.arvinclaw/config.json`
- Project config：`arvinclaw.config.json`
- 未来 local-only project config，用于不提交的个人偏好
- 用于 secrets 的环境变量

Configuration 不应变成 memory。它描述 runtime behavior；memory 描述 learned 或 durable context。

## 7. Hook Plan

Claude Code hooks 很有用，但 ArvinClaw 不应太早实现 hooks。

未来 hook events 可以包括：

- Before tool use
- After tool use
- Before model call
- After model response
- Session start
- Before compaction
- Task stop
- Subagent stop

Hooks 应延后到：

- Tool System 稳定
- Permission System 稳定
- Trace System 稳定
- Configuration 有 allow/deny controls

Hooks 很强大，所以从一开始就应有测试和权限边界。

## 8. Subagent Plan

Claude Code 的 subagents 是 task-specific workers 的强参考，它们拥有独立 context 和 tool permissions。

ArvinClaw 应在以下模块之后再做 subagents：

- Agent Loop
- Tool System
- Permission System
- Session Storage
- Execution Trace
- Planner

未来 subagents 应拥有：

- Name
- Description
- Purpose
- Allowed tools
- Model selection
- Separate context
- Trace linkage to parent task
- Permission boundaries

## 9. 不要复制什么

ArvinClaw 不应复制任一系统的所有内容。

不要太早复制：

- Full plugin marketplace
- Complex hook runtime
- Multi-agent delegation
- Automatic long-term memory writes
- Rich gateway architecture
- Messaging channel integrations
- Cloud or enterprise assumptions

MVP 应保持足够小，便于理解和测试。

## 10. 测试要求

Reference-inspired features 在实现时需要测试。

未来必需测试领域：

- Prompt file loading order
- Settings precedence
- Secret file denial
- Hook permission boundaries
- Subagent tool restrictions
- Memory write approval
- Workspace file redaction
- 通过 identity 或 memory files 进行 prompt injection 的回归测试

Reference systems 应该像影响 feature design 一样影响 test design。

## 11. 验收标准

这份 reference plan 成功标准：

- ArvinClaw 记录 OpenClaw 是 primary reference，Claude Code 是 secondary engineering reference。
- 借鉴的想法被映射到 ArvinClaw phases。
- MVP 范围仍小于任一完整参考系统。
- Prompt files、memory、hooks 和 subagents 有分阶段计划。
- Safety 和 testing requirements 在实现前已记录。

## 12. 来源

- [Claude Code overview](https://code.claude.com/docs/en/overview)
- [Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings)
- [Claude Code memory](https://docs.claude.com/en/docs/claude-code/memory)
- [Claude Code subagents](https://docs.claude.com/en/docs/claude-code/subagents)
- [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Default AGENTS.md](https://docs.openclaw.ai/reference/AGENTS.default)
- [OpenClaw SOUL.md Template](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)

## 13. 相关文档

- [主设计](../product/arvinclaw-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md)
- [Memory System](./memory-system.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Skill System](./skill-system.zh-CN.md)

# OpenClaw Implementation Notes

状态：草案
日期：2026-05-02

English version: [openclaw-implementation-notes.md](./openclaw-implementation-notes.md)

## 1. 目的

本文档记录 ArvinClaw 当前对 OpenClaw 架构和实现的理解。

它区分：

- OpenClaw 官方文档陈述的事实
- 通过 GitHub tree API 确认的仓库结构
- 基于文档和文件名做出的实现推断
- ArvinClaw 从这些发现中得到的设计决策

这种区分很重要，因为 ArvinClaw 的目标是实现一个 OpenClaw-like 系统，而不只是模仿表面功能。

## 2. 研究状态

当前状态：初步实现研究。

已使用的确认来源：

- OpenClaw 官方文档页面
- OpenClaw `llms.txt` 文档索引
- 通过 GitHub API 获取的 OpenClaw GitHub repository tree

尚未完成：

- 完整本地 clone 分析
- 逐行源码阅读
- 运行 OpenClaw runtime
- 执行 test suite

一次 shallow clone 尝试因 GitHub SSL 连接错误失败。因此，当前笔记将源码相关结论视为 repository-tree confirmations，除非该事实由官方文档直接说明。

## 3. 官方文档事实

### Agent Loop

OpenClaw 文档将 agent loop 描述为权威 run path：

```text
intake -> context assembly -> model inference -> tool execution -> streaming replies -> persistence
```

官方文档说明：

- 一个 loop 是每个 session 的单个 serialized run。
- Entry points 包括 Gateway RPC `agent` / `agent.wait` 和 CLI `agent`。
- `agent` RPC 验证参数、解析 session、持久化 session metadata，并返回 `{ runId, acceptedAt }`。
- `agentCommand` 解析 model 和 runtime defaults，加载 skills snapshot，并调用 `runEmbeddedPiAgent`。
- `runEmbeddedPiAgent` 通过 per-session 和 global queues 序列化 runs。
- `subscribeEmbeddedPiSession` 将 runtime events 桥接到 OpenClaw streams。
- Event streams 包括 lifecycle、assistant 和 tool events。
- Session writes 由 session write locks 保护。

### Context

OpenClaw 文档将 context 描述为一个 run 中发送给模型的全部内容。

官方文档说明 context 包括：

- OpenClaw-built system prompt
- Conversation history
- Tool calls and tool results
- Attachments and transcripts
- Compaction summaries and pruning artifacts

OpenClaw 区分 context 和 memory：

- Context 是当前模型窗口中放得下的内容。
- Memory 存在磁盘上，可以之后重新加载。

### System Prompt

OpenClaw 文档说明它为每次 agent run 构建自己的 system prompt。

官方文档说明 system prompt 包含固定 sections，例如：

- Tooling
- Execution Bias
- Safety
- Skills
- OpenClaw Self-Update
- Workspace
- Documentation
- Workspace Files
- Sandbox
- Current Date & Time
- Reply Tags
- Heartbeats
- Runtime
- Reasoning

OpenClaw 支持 prompt modes：

- `full`
- `minimal`
- `none`

OpenClaw 在 Project Context 下注入 workspace bootstrap files。

### Workspace Bootstrap Files

官方文档说明 OpenClaw 可以注入：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

`memory/*.md` 下的 daily files 不是普通 bootstrap Project Context 的一部分。它们通过 memory tools 访问，特定 startup/reset 场景除外。

### Agent Workspace

官方文档将 workspace 描述为 Agent 的 home。

官方文档说明：

- 默认 workspace 是 `~/.openclaw/workspace`。
- Config、credentials 和 sessions 位于 `~/.openclaw/` 下，而不是 workspace 内。
- Workspace 是默认 working directory，不是 hard sandbox。
- 标准 workspace files 包括 `AGENTS.md`、`SOUL.md`、`USER.md`、`IDENTITY.md`、`TOOLS.md`、`HEARTBEAT.md`、`BOOT.md`、`BOOTSTRAP.md`、`memory/YYYY-MM-DD.md`、`MEMORY.md`、`skills/` 和 `canvas/`。
- `skills/` 是最高优先级的 workspace-specific skill location。

### Memory

官方文档说明 OpenClaw 通过在 agent workspace 中写入 Markdown files 来记忆。

官方文档描述：

- `MEMORY.md` 是 long-term memory
- `memory/YYYY-MM-DD.md` 是 daily notes
- 可选 `DREAMS.md` 用于 dreaming summaries 和 human review
- `memory_search` 和 `memory_get` tools
- 默认 memory plugin `memory-core`
- SQLite-based builtin memory backend
- 配置 embeddings 时的 hybrid search
- Compaction 前的 automatic memory flush
- Optional dreaming 作为 background consolidation pass

## 4. 仓库树确认

GitHub tree 确认仓库中存在围绕这些文档概念的实现和测试。

确认路径包括：

- `src/agents/agent-command.ts`
- `src/agents/bootstrap-prompt.ts`
- `src/agents/command/session-store.ts`
- `src/agents/command/session.ts`
- `src/agents/memory-search.ts`
- `src/agents/pi-embedded-runner.ts`
- `src/agents/pi-embedded-runner/run.ts`
- `src/agents/pi-embedded-runner/lanes.ts`
- `src/agents/pi-embedded-runner/effective-tool-policy.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/pi-embedded-runner/context-engine-maintenance.ts`
- `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts`
- `extensions/codex/src/app-server/context-engine-projection.ts`
- `extensions/memory-wiki/src/gateway.ts`
- `docs/concepts/agent-loop.md`
- `docs/concepts/context-engine.md`
- `docs/concepts/system-prompt.md`
- `docs/concepts/memory-builtin.md`

仓库树也确认这些模块附近存在大量测试，包括：

- Agent command behavior
- Session store behavior
- Context engine projection
- Embedded runner behavior
- Compaction
- Tool policy
- Subagent session spawning
- Memory search
- Gateway behavior
- Security-related CodeQL and workflow checks

## 5. 实现推断

这些是推断，不是已逐行源码确认的事实。

### Runtime Shape

OpenClaw 可能分离了：

- Gateway entry and RPC handling
- Agent command orchestration
- Embedded runtime execution
- Session store and transcript persistence
- Prompt/bootstrap construction
- Plugin hooks
- Tool policy and execution control
- Context engine and compaction

这个推断由官方文档和 `agent-command.ts`、`pi-embedded-runner.ts`、`session-store.ts`、context-engine 文件等仓库路径共同支持。

### Context Engine

OpenClaw 似乎支持默认 context engine 和 plugin-provided context engines。

官方文档说明 `/compact` 和相关 context assembly 可以委托给 active context engine plugin。仓库路径确认了 context-engine 相关实现和测试。

### Skills

OpenClaw 将 compact skills list 注入 system prompt，并期待模型按需读取 `SKILL.md`。

这支持 ArvinClaw 当前计划：避免把所有 skill bodies 注入每次 model call。

### Memory

OpenClaw 的 memory system 比 ArvinClaw 的 MVP 计划更高级。

ArvinClaw 不应该立即实现 OpenClaw 的完整 memory stack。分阶段计划应是：

1. Session memory
2. Workspace prompt files
3. Daily notes
4. `MEMORY.md`
5. Memory search
6. Memory promotion/dreaming

## 6. ArvinClaw 设计影响

### Agent Loop

ArvinClaw 应将 loop 建模为：

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

这与 OpenClaw 文档化的 loop 对齐，同时保持 MVP 更小。

### Session Serialization

OpenClaw 按 session 序列化 runs，并用 locks 保护 transcript writes。

ArvinClaw 最终应实现：

- Per-session execution lanes
- Session write locks
- Explicit run IDs
- Runs 的 wait/status API

MVP 可以从更简单开始，但不应忽略这个设计压力。

### Prompt Assembly

ArvinClaw 应把 prompt assembly 做成一等模块。

它不应该在 CLI code 中临时拼 prompt。

预期输入：

- Base system prompt
- Tool descriptions
- Skill index
- Workspace files
- Session context
- Runtime metadata
- Permission policy guidance

### Workspace Files

ArvinClaw 应分阶段支持 OpenClaw-like workspace files：

- MVP/Phase 1：`AGENTS.md`
- Phase 1-2：read-only `SOUL.md`
- Phase 5：`USER.md`、`MEMORY.md`、`memory/YYYY-MM-DD.md`
- 后续：`TOOLS.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`

### Memory

OpenClaw 的 memory design 确认 file-based memory 是核心。

ArvinClaw 应保持 long-term memory 可见、可编辑、可审查，而不是隐藏在 opaque state 中。

### Skills

ArvinClaw 应遵循 OpenClaw 文档化的方法，让 skill bodies 按需加载。

System prompt 应包含 compact skill index，而不是每个完整 skill instruction。

### Hooks

OpenClaw 有很多 hook points。ArvinClaw 应将 hooks 延后到 tool、permission、trace 和 context assembly 稳定之后。

实现 hooks 时，需要清晰决策规则和测试。

## 7. 源码级后续开放问题

下一轮研究应检查源码：

- `agentCommand` 的精确形态
- `runEmbeddedPiAgent` 的精确形态
- `subscribeEmbeddedPiSession` 如何桥接 events
- Session write locks 如何实现
- Prompt reports 如何构建和持久化
- Bootstrap file truncation 如何实现
- Skill eligibility 如何计算
- Tool policy decisions 如何执行
- Context engine plugins 如何选择
- Memory search 和 memory flush 如何与 compaction 集成

## 8. ArvinClaw Backlog 更新

本研究建议新增或细化这些 ArvinClaw 文档：

- `prompt-assembly.md`
- `context-engine.md`
- `run-queue.md`
- `workspace-files.md`
- `memory-system.md`
- `configuration.md`
- `hooks.md`

也建议增加这些未来测试类别：

- Per-session queue serialization
- Session write lock behavior
- Prompt file loading order
- Bootstrap truncation
- Skill index size limits
- Tool policy enforcement
- Context compaction
- Memory flush before compaction

## 9. 来源

- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw Context](https://docs.openclaw.ai/concepts/context)
- [OpenClaw System Prompt](https://docs.openclaw.ai/concepts/system-prompt)
- [OpenClaw Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Context Engine](https://docs.openclaw.ai/concepts/context-engine)
- [OpenClaw Agent Runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)
- [OpenClaw llms.txt](https://docs.openclaw.ai/llms.txt)
- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)

## 10. 相关文档

- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)
- [Reference Systems](../architecture/reference-systems.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [Memory System](../architecture/memory-system.zh-CN.md)
- [Session Storage](../architecture/session-storage.zh-CN.md)

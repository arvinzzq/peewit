# OpenClaw Implementation Notes

状态：草案
日期：2026-05-02

English version: [openclaw-implementation-notes.md](./openclaw-implementation-notes.md)

## 1. 目的

本文档记录 Vole 当前对 OpenClaw 架构和实现的理解。

它区分：

- OpenClaw 官方文档陈述的事实
- 通过 GitHub tree API 确认的仓库结构
- 基于文档和文件名做出的实现推断
- Vole 从这些发现中得到的设计决策

这种区分很重要，因为 Vole 的目标是实现一个 OpenClaw-like 系统，而不只是模仿表面功能。

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

这支持 Vole 当前计划：避免把所有 skill bodies 注入每次 model call。

### Memory

OpenClaw 的 memory system 比 Vole 的 MVP 计划更高级。

Vole 不应该立即实现 OpenClaw 的完整 memory stack。分阶段计划应是：

1. Session memory
2. Workspace prompt files
3. Daily notes
4. `MEMORY.md`
5. Memory search
6. Memory promotion/dreaming

## 6. Vole 设计影响

### Agent Loop

Vole 应将 loop 建模为：

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

这与 OpenClaw 文档化的 loop 对齐，同时保持 MVP 更小。

### Session Serialization

OpenClaw 按 session 序列化 runs，并用 locks 保护 transcript writes。

Vole 最终应实现：

- Per-session execution lanes
- Session write locks
- Explicit run IDs
- Runs 的 wait/status API

MVP 可以从更简单开始，但不应忽略这个设计压力。

### Prompt Assembly

Vole 应把 prompt assembly 做成一等模块。

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

Vole 应分阶段支持 OpenClaw-like workspace files：

- MVP/Phase 1：`AGENTS.md`
- Phase 1-2：read-only `SOUL.md`
- Phase 5：`USER.md`、`MEMORY.md`、`memory/YYYY-MM-DD.md`
- 后续：`TOOLS.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`

### Memory

OpenClaw 的 memory design 确认 file-based memory 是核心。

Vole 应保持 long-term memory 可见、可编辑、可审查，而不是隐藏在 opaque state 中。

### Skills

Vole 应遵循 OpenClaw 文档化的方法，让 skill bodies 按需加载。

System prompt 应包含 compact skill index，而不是每个完整 skill instruction。

### Hooks

OpenClaw 有很多 hook points。Vole 应将 hooks 延后到 tool、permission、trace 和 context assembly 稳定之后。

实现 hooks 时，需要清晰决策规则和测试。

## 7. 源码确认发现（第二轮研究，2026-05-04）

以下内容来自直接的仓库文件访问确认。

### SKILL.md 确认格式

来自 `skills/skill-creator/SKILL.md` 和 `.agents/skills/` 的实际标准格式：

```markdown
---
name: skill-name
description: "When to use this skill and what it does."
---
# Skill Title

[Full markdown instructions for the agent — loaded only when the skill is triggered]
```

只有 `name` 和 `description` 是必需的 frontmatter 字段。`description` 同时用作目的说明和路由触发器（模型读取它来判断该 skill 是否适用）。正文是完整指令，触发时加载，目标不超过 5k 词。

渐进式加载：
1. Metadata（`name` + `description`）始终在上下文中 — 约 100 词
2. SKILL.md 正文在 skill 触发时加载 — 目标 <5k 词
3. 附属资源（`scripts/`、`references/`、`assets/`）由 Agent 按需加载

Vole 影响：我们的 `ContextSkillSummary.when` 字段不是标准字段。正确方式是单一 `description` 字段同时回答"这是什么"和"何时使用"。`when` 字段应被移除，其内容合并到 `description` 中。

### OpenClaw Tasks 与 TaskFlow（对比 Claude Code TodoWrite）

OpenClaw 在 `src/tasks/` 中有一个完整 task registry，基于 SQLite 持久化。这与 Claude Code 的 TodoWrite 完全不同。

**OpenClaw Tasks**（`task-registry.types.ts`）：
```typescript
type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "lost";
type TaskRecord = {
  taskId: string;
  runtime: "subagent" | "acp" | "cli" | "cron";
  task: string;
  status: TaskStatus;
  progressSummary?: string;
  terminalSummary?: string;
};
```

**OpenClaw TaskFlow**（`task-flow-registry.types.ts`）— 持久化多步骤 pipelines：
- 字段：`goal`、`currentStep`、`blockedSummary`、`stateJson`
- 状态：`queued | running | waiting | blocked | succeeded | failed | cancelled | lost`
- 两种模式：`managed`（TaskFlow 驱动步骤）和 `mirrored`（观察外部任务）
- 完整父子任务关系，支持多 Agent 协调

**Claude Code TodoWrite**（来自 Agent SDK 文档确认）：
- 模型直接调用的 tool（非基础设施级别）
- 临时性：仅存在于一次 agent turn 的上下文中
- Replace-all 列表：`{ todos: Array<{ content, status: "pending"|"in_progress"|"completed", activeForm }> }`
- 无 `TodoRead` — 消费方通过监听 stream 中的 `TodoWrite` tool call 来获取
- 目的：向用户展示 in-turn 进度

**对比**：

| | Vole Plan | Claude Code TodoWrite | OpenClaw TaskFlow |
| --- | --- | --- | --- |
| 存储 | 内存（单次 turn） | 上下文（单次 turn） | SQLite（持久化） |
| 生命周期 | Turn 开始时创建 | 模型按需调用 | 跨 session 持久存在 |
| 驱动方式 | AgentRuntime（基础设施） | 模型（tool call） | TaskFlow 引擎（基础设施） |
| 状态 | pending/running/complete/failed/skipped | pending/in_progress/completed | 7 种状态含 blocked/lost |
| 多 Agent | 否 | 否 | 是（父子任务） |
| 目的 | 把目标拆分为步骤 | 向用户展示进度 | 后台 job 编排 |

**Vole 影响**：预执行 `Plan` 结构（基础设施驱动的分步执行）已被移除。正确方式是模型调用的 `update_todos` tool 等价物 — 已由第三轮研究（第 8 节）确认。TaskFlow 等价的持久化（SQLite、跨 session）属于 Phase 8+。

### `pi-embedded-runner` Execution Lanes

确认：`pi-embedded-runner/lanes.ts` 处理的是 session 与 global command lanes（`session:<key>` 命名），而不是 task/plan 追踪。Plan state management（`buildAgentRuntimePlan`、`emitAgentPlanEvent`）在 `run.ts` 中 — 是 embedded runner 的内部逻辑，不是用户可见的 todos。

## 8. 源码确认发现（第三轮研究，2026-05-04）

以下内容来自直接的仓库文件访问和文档 fetch 确认。

### `update_plan` Tool — Per-Turn 进度追踪器

来源：`src/agents/tools/update-plan-tool.ts`，测试文件 `src/agents/openclaw-tools.update-plan.test.ts`。

OpenClaw 有一个模型可调用的 tool，用于在执行过程中追踪任务进度。Schema：

```typescript
plan: Array<{
  step: string;
  status: "pending" | "in_progress" | "completed"
}>
```

同一时刻最多一个步骤处于 `in_progress` 状态。模型每次调用时全量替换列表（与 Claude Code 的 `TodoWrite` 模式相同）。

**启用规则：**
- 默认禁用 — 需要在 config 中设置 `tools.experimental.planTool: true`。
- 对 GPT-5 / GPT-5.5+ 模型在 `executionContract` 未设置或为 `strict-agentic` 时自动启用。
- **不**对 Anthropic Claude 自动启用 — 必须显式开启。
- 显式设置 `tools.experimental.planTool: false` 即使在 `strict-agentic` 下也会禁用。

**与已移除 Vole Plan 的关键区别：** 模型在执行*过程中*调用 `update_plan` 追踪已完成的工作 — 而不是在执行*之前*生成供 runtime 编排的计划。该 tool 不包含任何基础设施侧的执行管理。

**与 Claude Code TodoWrite 的关系：** 结构上完全一致 — 都是模型调用、全量替换、`pending/in_progress/completed` 状态列表。OpenClaw 的 `update_plan` 就是其 TodoWrite 的原生等价物。

Vole 影响：按此模型调用模式实现 `update_todos` tool。不需要基础设施编排。

### 规划停滞检测（Planning Stall Detection）

来源：`src/agents/pi-embedded-runner/run/incomplete-turn.ts`。

OpenClaw 会主动检测模型只生成规划文字而不执行任何 tool action 的情况，并强制纠正。检测使用三个 regex pattern：

- `PLANNING_ONLY_PROMISE_RE` — 匹配 "I'll..."、"let me..."、"I'm going to..."
- `PLANNING_ONLY_HEADING_RE` — 匹配标题如 "Plan:"、"Steps:"、"Approach:"
- `PLANNING_ONLY_BULLET_RE` — 匹配项目符号或编号步骤列表

检测到时，runner 注入：
```
PLANNING_ONLY_RETRY_INSTRUCTION = "The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can."
```

如果模型持续输出规划文字而不动作，run 会终止：
```
STRICT_AGENTIC_BLOCKED_TEXT = "Agent stopped after repeated plan-only turns without taking a concrete action."
```

重试限制：
- 默认：1 次规划停滞重试后终止。
- `executionContract: "strict-agentic"`：2 次后硬终止。

Vole 影响：这是 Phase 4 值得加入的高价值机制。没有它，模型可能无限叙述计划而不采取行动。该检查应在 `AgentRuntime` 中每次模型响应后、tool dispatch 前执行。

### `sessions_spawn` — Subagent 系统

来源：`https://docs.openclaw.ai/tools/subagents`，`docs/tools/subagents.md`。

这是 OpenClaw 处理长程复杂任务分解和并行工作的主要机制：

- 主 agent 调用 `sessions_spawn` 启动后台子 agent。
- 每个子 agent 在独立 session 中运行（`agent:<id>:subagent:<uuid>`），拥有隔离的 context。
- 完成后 push 结果回父 agent — 非轮询。
- 支持 orchestrator 模式：主 → orchestrator 子 agent → worker 子 agents（最大 depth 2）。
- 默认最大并发子 agent 数：全局 8，每个父 session 5。
- Context 模式：`isolated`（默认 — 全新 context，成本更低）或 `fork`（分叉父 transcript）。

在 `coding` 和 `full` tool profiles 中默认可用；`messaging` 中不可用。

Vole 影响：Subagents 属于 Phase 7+ 工作，需要 gateway 和 multi-session 基础设施。不在早期 phases 实现。

### `strict-agentic` Execution Contract

设置更严格的 in-turn 执行行为：
- 对支持的模型自动启用 `update_plan`（Anthropic 默认不自动启用）。
- 将规划停滞重试限制从 1 提高到 2 次后硬终止。
- 整个 run 期间执行更严格的防停滞行为。

### Thinking Budget

OpenClaw 暴露可配置的推理预算：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`adaptive`、`max`。

- Anthropic Claude 4.6 默认为 `adaptive`。
- Thinking 在每次 tool call 前在模型内部进行 — 不是单独的预规划 pass。
- 通过 `/think:<level>` 内联指令、session 默认值或每 agent 配置控制。

Vole 影响：暂缓。Anthropic 模型在内部处理此事。Phase 9+ 之前不需要配置接口。

## 9. 源码级后续开放问题

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

## 11. Vole Backlog 更新

本研究建议新增或细化这些 Vole 文档：

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

## 12. 来源

- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw Context](https://docs.openclaw.ai/concepts/context)
- [OpenClaw System Prompt](https://docs.openclaw.ai/concepts/system-prompt)
- [OpenClaw Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Context Engine](https://docs.openclaw.ai/concepts/context-engine)
- [OpenClaw Agent Runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)
- [OpenClaw llms.txt](https://docs.openclaw.ai/llms.txt)
- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)

## 13. 相关文档

- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)
- [Reference Systems](../architecture/reference-systems.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [Run Queue](../architecture/run-queue.zh-CN.md)
- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [Context Engine](../architecture/context-engine.zh-CN.md)
- [Memory System](../architecture/memory-system.zh-CN.md)
- [Session Storage](../architecture/session-storage.zh-CN.md)

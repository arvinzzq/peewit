# Peewit Roadmap

状态：草案
日期：2026-05-02

English version: [overview.md](./overview.md)

## 1. Roadmap 原则

Peewit 应该通过可用的产品里程碑演进，而不是通过孤立的技术实验演进。

参考系统：[Reference Systems](../architecture/reference-systems.zh-CN.md)

OpenClaw 架构映射：[OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)

每个阶段都应该产出：

- 用户可见能力
- 更清晰的架构边界
- 新模块的学习文档
- 保护新增行为和模块契约的测试
- 可验证的验收标准
- 明确的非目标，以防范围膨胀

Roadmap 采用双轨方法：

- 产品轨：每个阶段都应该让 Peewit 更有用。
- 学习轨：每个阶段都应该解释它引入的 Agent 架构。
- 质量轨：每个阶段都应该为它引入的行为新增或更新测试。

## 2. 阶段摘要

| Phase | 状态 | 目标 | 产品结果 | 架构焦点 |
| --- | --- | --- | --- | --- |
| Phase 0 | Complete | 项目基础 | 带文档说明的 TypeScript workspace 和 CLI shell | Monorepo、配置、context package、文档布局 |
| Phase 1 | Complete | MVP agent loop | CLI chat 可以调用模型并产生可追踪响应 | Agent Core、context assembly、ModelProvider、基础 loop |
| Phase 2 | Complete | 工具与权限 | Agent 可以检查文件、运行已批准命令，并读取 Web 内容 | Tool Registry、PermissionPolicy |
| Phase 3 | Complete | Context assembly 与 skills | Agent 有包含工具、skills 和权限指导的结构化 context；可加载 `SKILL.md`；Claude 可直接使用 | Context section 架构、Anthropic provider、skill loader |
| Phase 4 | Complete | In-turn 任务追踪 | Agent 在执行过程中透明地追踪复杂任务进度，避免规划停滞 | `update_todos` tool、规划停滞检测 |
| Phase 5 | Complete | 会话与记忆 | Agent 可以记住会话，并使用本地知识 | Session store、trace store、memory interfaces |
| Phase 6 | Complete | Streaming 与 Web UI | CLI 逐 Token 流式输出；浏览器端聊天含 trace 和审批 | Streaming ModelProvider、Ink CLI、Web adapter、SSE |
| Phase 7 | Complete | 多入口 adapters | CLI、Web、桌面和消息入口共享一个 Agent Core | Adapter interface、gateway direction |
| Phase 8 | Complete | 后台自动化 | Agent 可以运行定时和事件触发任务 | Scheduler、daemon、task queue |
| Phase 9 | Complete | Plugin 和 skill 生态 | 用户可以安装、启用、禁用和审查能力 | Plugin metadata、permission declarations、versioning |
| Phase 10 | Complete | 完整个人 Agent 平台 | OpenClaw-like 的个人 Agent，具备多模型、多 Agent、多节点和沙箱化工具 | Gateway、multi-agent runtime、node protocol、sandboxing |

部分后续阶段的学习文档会先以 planned filenames 的形式列出，实际文件尚未存在。它们应该在对应 phase 被正式设计时创建，而不是在 MVP setup 阶段一次性全部创建。

进度细节保存在 phase plan 文档中。Roadmap status 应保持高层，只在 phase 开始、完成或 scope 出现实质变化时更新。

## 3. Phase 0：项目基础

### 用户结果

用户可以检查清晰的项目结构，并在实现开始前理解预期架构。

### 新增架构

- 轻量 monorepo 结构
- CLI app 边界
- core、config、models、tools、skills、permissions 和 sessions 的 package 边界
- 用于 prompt 和 context assembly 的 context package 边界
- 配置文件约定
- 文档结构

### 学习文档

- `docs/roadmap/overview.md`
- `docs/architecture/project-structure.md`
- `docs/architecture/configuration-system.md`
- `docs/product/` 下的主设计文档

主要架构说明：[项目结构](../architecture/project-structure.zh-CN.md)

支持架构说明：[Configuration System](../architecture/configuration-system.zh-CN.md)

### 验收标准

- 仓库包含约定的 monorepo 目录布局。
- 项目有根 README，解释 Peewit 是什么。
- 主设计文档链接到 roadmap。
- 架构文档解释 Agent Core 为什么与 CLI 分离。

### 非目标

- 暂不实现完整 agent loop。
- 暂不做 Web UI。
- 暂不做 plugin marketplace。
- 暂不做后台自动化。

## 4. Phase 1：MVP Agent Loop

### 用户结果

用户可以启动 `peewit chat`，发送消息，收到模型响应，并看到该交互的可解释 trace。

### 新增架构

- Agent Core
- Context assembly package
- `ModelProvider` interface
- OpenAI-compatible model provider
- 基础 agent loop
- Execution trace model
- CLI chat adapter

### 学习文档

- `docs/architecture/agent-loop.md`
- `docs/architecture/model-provider.md`
- `docs/architecture/execution-trace.md`
- `docs/architecture/cli-adapter.md`
- `docs/plans/phase-1-mvp-test-guide.md`

主要架构说明：[Agent Loop](../architecture/agent-loop.zh-CN.md)

支持架构说明：[Model Provider](../architecture/model-provider.zh-CN.md)

支持架构说明：[Execution Trace](../architecture/execution-trace.zh-CN.md)

支持架构说明：[CLI Adapter](../architecture/cli-adapter.zh-CN.md)

用户验证指南：[Phase 1 MVP Test Guide](../plans/phase-1-mvp-test-guide.zh-CN.md)

### 验收标准

- `peewit chat` 启动交互式 session。
- CLI 可以调用 OpenAI-compatible model provider。
- Agent Core 不导入 CLI-specific code。
- 每次响应都会产生 trace entry。
- 模型配置可以从配置文件和环境变量加载。
- 缺少 API key 时，CLI 产生清晰错误。
- Fake-provider paths 保留用于本地学习和测试。

### 非目标

- 暂不做复杂规划。
- 暂不做长期记忆。
- 暂不做 Web UI。
- 暂不做 multi-agent runtime。

### Phase 1 后的 OpenClaw 差距

Phase 1 有意停在 persistent sessions、workspace prompt loading、memory files、tools、permissions、skills、channels、heartbeat 和 multi-agent behavior 之前。

下一个 OpenClaw-aligned increment 应先添加 session storage 和 short-term memory，再扩展 tools 或 channels。

## 5. Phase 2：工具与权限

### 用户结果

Agent 可以安全使用基础工具：

- 读取 workspace 内文件
- 列目录
- 确认后写文件
- 明确确认后执行 shell 命令
- 通过已配置 providers 搜索或读取 Web 内容

### 新增架构

- Tool interface
- Tool registry
- Tool result schema
- Risk classification
- Permission policy
- CLI 中的 permission prompts

### 学习文档

- `docs/architecture/tool-system.md`
- `docs/architecture/permission-system.md`

主要架构说明：[Tool System](../architecture/tool-system.zh-CN.md)

支持架构说明：[Permission System](../architecture/permission-system.zh-CN.md)

实施计划：[Phase 2 Tools and Permissions](../plans/phase-2-tools-and-permissions.zh-CN.md)

### 验收标准

- 工具可以注册，而不需要修改 Agent Core 逻辑。
- `confirm` 模式下 Low-risk actions 可以自动运行。
- Medium 和 High risk actions 需要确认。
- Blocked actions 被拒绝，除非显式配置。
- Tool calls 和 permission decisions 出现在 execution trace 中。

### 非目标

- 暂不做完整 sandbox。
- 暂不做 browser automation。
- 暂不做 remote tool nodes。

## 6. Phase 3：Context Assembly 与 Skills

### 用户结果

Agent 的 system prompt 有包含 identity、runtime、tooling、safety、skills 和 workspace 的结构化 sections。模型通过 tooling section 知道哪些工具可用。Agent 可以加载本地 skills 指导行为。可通过 Anthropic API 直接使用 Claude。

### 新增架构

- 基于 section 的 context assembly（`ContextToolSummary`、`ContextSkillSummary`、命名 sections）
- Tool summaries 从 `AgentRuntime` 流经 context assembler 进入 system prompt
- System prompt 中的 permission guidance section
- Anthropic provider
- Skill directory scanner
- `SKILL.md` parser
- Skill precedence rules：workspace > user > built-in
- 内置 skills
- Skill index 注入 context

### 学习文档

- `docs/architecture/skill-system.md`
- `docs/decisions/0005-anthropic-provider.md`

主要架构说明：[Skill System](../architecture/skill-system.zh-CN.md)

实施计划：[Phase 3 Context Assembly and Skills](../plans/phase-3-context-assembly-and-skills.zh-CN.md)

### 验收标准

- Context assembler 在有相关输入时包含 tooling、safety 和 skills sections。
- Tool 描述出现在 system prompt 中。
- Skills 可以从项目、用户和内置位置加载。
- 同名情况下，项目 skills 覆盖用户和内置 skills。
- CLI 可以通过 `/skills` 列出已加载 skills。
- Skills 通过 system prompt 影响 Agent 行为，不能绕过 Tool 和 Permission systems。
- 通过 `model.provider: "anthropic"` 可选择 Anthropic provider。

### 非目标

- 暂不做 remote skill installation。
- 暂不做 public marketplace。
- 暂不做 skill version manager。
- 暂不允许 skill files 任意授予权限。
- 暂不做 context compaction。
- 暂不做流式输出。

## 7. Phase 4：In-Turn 任务追踪

### 用户结果

Agent 在执行过程中透明地追踪复杂任务进度。用户可以看到已完成了哪些步骤以及下一步是什么。Agent 不会因为不断叙述计划而不采取行动而停滞。

### 新增架构

- `update_todos` tool：模型调用的 per-turn 任务追踪 tool（等同于 OpenClaw `update_plan` 和 Claude Code `TodoWrite`）
- `AgentRuntime` 中的规划停滞检测：检测 plan-only turns 并注入重试指令
- CLI 进度展示：每次 turn 后展示当前 todo 状态

### 设计对齐

OpenClaw 的方式（来自 2026-05-04 源码确认）：

1. **`update_plan` tool** — 模型在执行过程中调用它更新步骤状态。不是预执行规划器。全量替换列表：`{step, status: pending|in_progress|completed}[]`。
2. **规划停滞检测** — runtime 检测 "I'll..."、项目符号列表、没有 tool action 的步骤标题，并注入重试指令强制立即执行。
3. **先执行，再规划** — 模型立即行动，边做边更新计划状态。

Peewit 的 `update_todos` 遵循同样的模型调用、无基础设施编排模式。

### 学习文档

- `docs/plans/phase-4-in-turn-task-tracking.md`
- `docs/research/openclaw-implementation-notes.md` 第 8 节

### 验收标准

- 模型可以调用 `update_todos`，使用 `pending`、`in_progress` 或 `completed` 状态声明和更新任务步骤。
- 模型更新 todo 时，CLI 在每次 turn 后展示当前 todo 列表。
- `AgentRuntime` 检测 plan-only turns（无 tool calls、含规划 pattern 的文字）并注入重试指令。
- 连续 `N` 次 plan-only turns 后，run 以清晰的错误消息终止。
- `update_todos` 作为标准 tool 注册；不添加基础设施编排。

### 非目标

- 不做基础设施驱动的分步执行（先执行才是正确模式）。
- 不做 subagent spawning（Phase 7+）。
- 不做 SQLite 持久化 TaskFlow（Phase 8+）。
- 不做阻塞执行直到计划被批准的预执行规划器。

## 8. Phase 5：会话、记忆与知识

### 用户结果

Agent 可以保存 session history，展示之前的 traces，并开始跨任务使用本地知识。

### 新增架构

- Session store
- Trace store
- Memory interface
- Local knowledge retrieval interface

### 学习文档

- `docs/architecture/session-storage.md`
- `docs/architecture/memory-system.md`
- `docs/architecture/local-knowledge.md`
- `docs/plans/phase-5-sessions-and-memory.md`

`local-knowledge.md` 是 planned document，目前尚未创建。

主要架构说明：[Session Storage](../architecture/session-storage.zh-CN.md)

支持架构说明：[Memory System](../architecture/memory-system.zh-CN.md)

实施计划：[Phase 5 Sessions and Memory](../plans/phase-5-sessions-and-memory.zh-CN.md)

### 验收标准

- Sessions 可以保存和恢复。
- Traces 可以在 session 结束后检查。
- Memory 与原始 chat history 分离。
- Agent 可以在 context 中使用 recent session history。
- 第一版 memory implementation 未来可以被替换。

### 非目标

- 暂不做 cloud sync。
- 暂不做 multi-user account system。
- 暂不做复杂 personal data graph。

## 9. Phase 6：Streaming 与 Web UI

### 用户结果

用户可以在终端看到模型响应逐 token 流式输出，也可以通过 browser-based interface 使用 Peewit，包含 chat、trace inspection 和 permission approval controls。

### 新增架构

- Streaming `ModelProvider` 变体（token delta events）
- CLI 渲染升级至 **Ink**（基于 React 的终端 UI）：实时 streaming 输出、tool 进度指示器、更丰富的 permission prompts
- Web app
- Agent Core 之上的 API layer
- Trace visualization
- Permission approval UI

### CLI 渲染说明

Phase 6 是 CLI 渲染架构需要演进的时机。当前的纯 stdout 输出适合 non-streaming turns，但无法支持实时 streaming 或原地 UI 更新。计划的升级是采用 **Ink** 作为 CLI 渲染框架。Ink 是基于 React 的终端 UI 库 — 与 OpenClaw 使用的相同 — 允许组件原地渲染和重新渲染。升级完全在 CLI adapter 层内完成，Agent Core 和其他所有 packages 不受影响。完整说明和采用条件参见 [CLI Adapter](../architecture/cli-adapter.zh-CN.md) 第 15 节。

### 学习文档

- `docs/architecture/ui-adapters.md`
- `docs/architecture/trace-visualization.md`

### 验收标准

- 模型响应在 CLI 中逐 token 流式输出。
- CLI 使用 Ink 组件处理 streaming 输出、进度和 approval prompts。
- Web UI 可以使用与 CLI 相同的 Agent Core。
- Tool calls 和 permission prompts 在 UI 中可见。
- CLI 和 Web UI 共享 session 和 trace 概念。

### 非目标

- 暂不做 desktop app。
- 暂不做 mobile app。
- 暂不做 public hosted service。

## 10. Phase 7：多入口 Adapters

### 用户结果

用户可以从多个入口与同一个 Agent 交互，同时保持相同核心行为。

### 新增架构

- Entry adapter interface
- Shared session routing
- Adapter-specific capabilities
- Early gateway direction

### 学习文档

- `docs/architecture/adapters.md`
- `docs/architecture/gateway.md`
- `docs/plans/phase-7-multi-entry-adapters.md`

主要架构说明：[Adapters](../architecture/adapters.zh-CN.md)

支持架构说明：[Gateway](../architecture/gateway.zh-CN.md)

实施计划：[Phase 7 Multi-Entry Adapters](../plans/phase-7-multi-entry-adapters.zh-CN.md)

### 验收标准

- CLI 和 Web UI 共享 Agent Core，不重复 orchestration logic。
- 新 adapters 可以通过清晰边界加入。
- Adapter capabilities 可以被显式表示。

### 非目标

- 暂不做完整 OpenClaw-style node network。
- 暂不做复杂 multi-device sync。

## 11. Phase 8：后台自动化

### 用户结果

Agent 可以在没有前台 chat session 的情况下运行定时任务，或响应已配置事件。

### 新增架构

- Scheduler
- Daemon mode
- Task queue
- Event trigger interface
- Background trace persistence

### 学习文档

- `docs/architecture/background-automation.md`
- `docs/architecture/task-queue.md`
- `docs/plans/phase-8-background-automation.md`

主要架构说明：[后台自动化](../architecture/background-automation.zh-CN.md)

支持架构说明：[Task Queue](../architecture/task-queue.zh-CN.md)

实施计划：[Phase 8 后台自动化](../plans/phase-8-background-automation.zh-CN.md)

### 验收标准

- 用户可以定义 scheduled task。
- Background tasks 产生 traces。
- 危险动作仍遵守 permission policy。
- 失败的 background tasks 对用户可见。

### 非目标

- 暂不做完全自主且不受限制的执行。
- 暂不做 enterprise workflow engine。

## 12. Phase 9：Plugin 和 Skill 生态

### 用户结果

用户可以安装和管理 skills 或 plugins，并看到 metadata、permissions 和 trust boundaries。

### 新增架构

- Plugin metadata format
- Skill/package installation path
- Enable/disable controls
- Permission declarations
- Version tracking
- Trust review flow

### 学习文档

- `docs/architecture/plugin-system.md`
- `docs/architecture/skill-permissions.md`

实施计划：[Phase 9 Plugin 和 Skill 生态](../plans/phase-9-plugin-skill-ecosystem.zh-CN.md)

### 验收标准

- Installed skills 可以列出和禁用。
- Permission declarations 在使用前可见。
- Third-party skills 不能静默获得 tool permissions。
- Version 和 source metadata 被记录。

### 非目标

- 暂不运营 public marketplace。
- 暂不自动信任 third-party code。

## 13. Phase 10：完整个人 Agent 平台

### 用户结果

Peewit 成为完整个人 Agent 平台：多入口、多模型、多 Agent、可扩展、可观察，并且足够安全以支持日常使用。

### 新增架构

- Gateway
- Multi-agent runtime
- Multi-node protocol
- Remote and local tool execution
- 更强 sandbox
- Provider ecosystem
- 成熟产品设置

### 学习文档

- `docs/architecture/multi-agent-runtime.md`
- `docs/architecture/node-protocol.md`
- `docs/architecture/sandboxing.md`
- `docs/architecture/gateway.md`

实施计划：[Phase 10 完整平台](../plans/phase-10-full-platform.zh-CN.md)

### 验收标准

- 多个入口可以与同一个 agent runtime 通信。
- 多个 model providers 可以配置。
- Agents 可以拥有独立 workspaces 和 skills。
- Tool execution 可观察且受权限控制。
- 系统作为真实个人助理仍然可用。

### 非目标

- 不保证与 OpenClaw 完全对等。
- 除非后续明确选择，否则不假设 enterprise SaaS。

## 14. OpenClaw 对齐 Backlog

Phase 0–10 已全部完成。以下是 Peewit 与 OpenClaw 生产能力之间剩余的差距。

完整设计：[OpenClaw 对齐计划](../plans/openclaw-alignment.zh-CN.md)

| 优先级 | 差距 | 迭代 |
| --- | --- | --- |
| 🔴 高 | 上下文压缩 | 1 |
| 🔴 高 | Skill 全文按需加载（`load_skill` 工具） | 1 |
| 🔴 高 | `memory_search` 工具 | 2 |
| 🟡 中 | Prompt 模式（full / minimal / none） | 1 |
| 🟡 中 | `memory_get` 工具 | 2 |
| 🟡 中 | 额外工作区文件（TOOLS.md、IDENTITY.md、HEARTBEAT.md、BOOTSTRAP.md） | 2 |
| 🟡 中 | 心跳机制 | 2 |
| 🟡 中 | Strict-agentic 执行合约 | 3 |
| 🟡 中 | 会话写锁 | 3 |
| 🟡 中 | Hooks 系统 | 3 |
| 🟡 中 | 工具 Profile（coding / full / messaging / background） | 4 |
| 🟡 中 | 沙箱执行（工作区边界约束） | 4 |
| 🟡 中 | Cron Daemon（`peewit daemon`） | 5 |
| 🟢 低 | TaskFlow（持久跨会话任务图） | 6 |
| 🟢 低 | 异步子 Agent（push-based，fork 上下文模式） | 6 |
| 🟢 低 | WebSocket 支持 | 7 |
| 🟢 低 | Thinking Budget 配置 | 7 |
| 🟢 低 | 记忆 Dreaming / 记忆晋升 | 7 |

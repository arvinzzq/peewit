# Memory System

状态：草案
日期：2026-05-02

English version: [memory-system.md](./memory-system.md)

## 1. 目的

Memory system 定义 ArvinClaw 如何在 turns、sessions，以及最终长期个人使用中保存有用上下文。

ArvinClaw 应该学习 OpenClaw 的 file-based workspace model，但应该分阶段实现 memory，让 MVP 保持可理解、可测试和安全。

核心规则：

MVP 包含 short-term 和 session memory。Curated long-term memory 现在设计，但在 permission、trace 和用户控制清楚后再实现。

## 2. OpenClaw 参考模型

OpenClaw 使用 agent workspace 中的纯 Markdown 文件作为 durable memory 和 identity surfaces。

值得学习的重要 OpenClaw 概念：

- `SOUL.md`：Agent personality、values、tone 和 boundaries。
- `USER.md`：User-specific context 和 preferences。
- `MEMORY.md`：Durable long-term facts、preferences 和 decisions。
- `memory/YYYY-MM-DD.md`：Daily notes 和 recent observations。
- `AGENTS.md`：Operational rules 和 task instructions。
- `TOOLS.md`：Tool 和 environment notes。

OpenClaw 文档将 memory 描述为基于文件：模型只记得保存到磁盘的东西。它们也描述了 startup behavior：在响应前读取 `SOUL.md`、`USER.md`、最近 daily notes 和 `MEMORY.md`。

ArvinClaw 应借鉴这种模型的清晰性，同时保持初始实现更小。

## 3. ArvinClaw Memory Layers

ArvinClaw 应使用四个 memory-related layers。

| Layer | MVP Status | Purpose |
| --- | --- | --- |
| Active context | Included | 当前 turn 或 task 的 model context |
| Short-term memory | Included | 当前 session messages、tool observations、trace summaries、recent working state |
| Long-term memory | Policy included, content loading deferred | 跨 sessions 的 curated durable knowledge |
| Identity and instruction files | Designed, partially included | 稳定 prompt files，例如 `SOUL.md`、`USER.md` 和 `AGENTS.md` |

## 4. Active Context

Active context 是模型在某一次具体 model call 中看到的内容。

它可以包括：

- System instructions
- Selected identity and instruction files
- Current user message
- Recent conversation turns
- Selected skill instructions
- Tool definitions
- Recent tool observations
- Trace summaries
- Current plan

Active context 不是 durable memory。它为一次 model call 组装，并可能在调用后丢弃。

## 5. Short-Term Memory

Short-term memory 是 session 或 task 的工作记忆。

在 MVP 中，它应该通过 session storage 实现：

- User messages
- Assistant messages
- Tool observations
- Trace events
- Current task or plan state
- 需要 compaction 时的 recent summaries

Short-term memory 应是本地、结构化且可检查的。

它不应自动变成 long-term memory。

## 6. Long-Term Memory

Long-term memory 存储跨 sessions 的 durable facts、preferences、decisions 和 project knowledge。

ArvinClaw 应为未来的 `MEMORY.md` 做设计，但不在第一版 MVP 中实现完整 long-term memory writes。

Phase 5 为 long-term memory files 增加显式 policy switch：

- `disabled`：默认值；不加载 `USER.md`、`MEMORY.md` 或 daily memory files。
- `read-only`：存在时，从 configured workspace root 加载 `USER.md`、`MEMORY.md`、今天的 daily memory file 和昨天的 daily memory file。写入保持 disabled。
- `write`：读取加载与 `read-only` 相同，另外启用 `append_daily_memory` tool。模型可将笔记追加到 `memory/YYYY-MM-DD.md`，这是 medium-risk 操作（在 `confirm` 模式下需要用户批准）。

## 7. Identity and Instruction Files

ArvinClaw 应支持受 OpenClaw 启发的 workspace prompt files，但要谨慎分阶段。

建议文件：

| File | Purpose | MVP Status |
| --- | --- | --- |
| `AGENTS.md` | Operational rules 和 project instructions | Phase 0 或 Phase 1 |
| `SOUL.md` | Agent personality、values、tone 和 boundaries | Phase 1 optional，Phase 2 recommended |
| `USER.md` | User profile、preferences 和 durable user context | Policy enabled 时只读加载 |
| `MEMORY.md` | Curated long-term memory | Policy enabled 时只读加载 |
| `memory/YYYY-MM-DD.md` | Daily notes 和 recent observations | Policy 为 `read-only` 或 `write` 时只读加载今天/昨天；Policy 为 `write` 时可通过 `append_daily_memory` tool 写入 |
| `TOOLS.md` | Environment and tool notes | Deferred |

MVP 从 `AGENTS.md` 风格 operational instructions、read-only `SOUL.md` 和 session storage 开始。Context loader 要包含 `USER.md` 和 `MEMORY.md` 前，long-term memory policy 必须先切到 `read-only`。

## 8. `SOUL.md` Design

`SOUL.md` 应定义 Agent 的 internal behavioral identity：

- Values
- Tone
- Communication style
- Boundaries
- Relationship to memory and growth

它不应包含：

- Secrets
- Tool credentials
- 来自外部内容且未经审查的 instructions
- Permission bypass rules

安全规则：

Agent 不能静默修改 `SOUL.md`。如果未来允许 self-modification，必须要求明确用户批准，并产生 trace event。

## 9. `USER.md` Design

`USER.md` 应描述 user-specific context：

- User preferences
- Communication preferences
- 用户希望记住的 stable personal facts
- Project or workflow preferences
- Boundaries and privacy preferences

因为 `USER.md` 可能包含敏感个人信息，ArvinClaw 不应在 MVP 中实现对它的自动写入。

未来写入应要求明确用户批准。

## 10. `MEMORY.md` Design

`MEMORY.md` 应包含 curated long-term memory：

- Durable decisions
- Repeated preferences
- Stable project facts
- Lessons learned
- 应跨 sessions 保留的 open loops

它不应是 raw transcript dump。

未来 memory writes 应包含：

- Proposed memory text
- 写入原因
- Source session 或 trace reference
- 对敏感或个人 facts 的用户批准

## 11. Daily Memory Files

例如 `memory/YYYY-MM-DD.md` 的 daily files 可以保存 recent observations 和 working notes。

它们适用于：

- Recent context
- Daily task history
- Short-term recall
- 未来 long-term promotion 的 candidate facts

Phase 5 只会在 `read-only` 模式下加载今天和昨天的 daily memory files。它不会扫描所有历史 daily files，也不会写入 daily notes。

## 12. Startup Context Loading

未来 session startup 可以按受控顺序加载上下文：

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Today's and yesterday's daily memory, if enabled
  -> Session resume context
  -> Selected skills
```

MVP 应从更小的顺序开始：

```text
Base system instructions
  -> Project/user configuration
  -> Session resume context
  -> Selected skills
```

每增加一个 prompt file，都应有测试和 trace visibility。

## 13. Memory Write Policy

Memory writes 影响很大，因为它们会影响未来 sessions。

已实现 policy：

- `disabled` 或 `read-only` 模式下不做 automatic long-term memory writes。
- Session storage writes 作为正常操作的一部分允许。
- Prompt identity files（`SOUL.md`、`USER.md`、`MEMORY.md`）始终 read-only。
- 除非 policy 显式为 `read-only` 或 `write`，否则不加载 long-term memory files。
- Policy 为 `write` 时，`append_daily_memory` tool 被注册。模型可调用它向 `memory/YYYY-MM-DD.md` 追加笔记。Risk level：`medium` — 在 `confirm` 模式下需要用户批准。
- `append_daily_memory` tool 只写入今天的 daily file，不能覆盖 `MEMORY.md`、`USER.md` 或 `SOUL.md`。

未来 policy：

- 模型为 `MEMORY.md`（curated long-term memory）提出条目。
- 用户可以批准、编辑或拒绝提议的 memory 条目。
- `USER.md` 更新需要用户显式发起。
- Memory writes 产生 trace events。

## 14. Relationship to Permissions

Memory writes 应通过 permission policy。

建议风险等级：

- Session message append：Low
- Trace event append：Low
- Daily note write：Medium
- `MEMORY.md` update：Medium 或 High，取决于内容
- `USER.md` update：High
- `SOUL.md` update：High
- Secret-like memory write：默认 Blocked

## 15. Relationship to Skills

Skills 可以指导 memory behavior，但不能直接写 memory。

未来 memory-related skills 可以包括：

- `memory-curator`
- `daily-notes`
- `user-profile`
- `project-memory`

这些 skills 应提出要记住什么。Tools 和 permissions 控制实际写入。

## 16. 测试要求

Memory 需要强测试，因为它会改变未来行为。

必需测试领域：

- Prompt file loading order
- Missing prompt file behavior
- Session memory reconstruction
- MVP 中 long-term memory disabled
- Long-term memory policy validation and display
- Policy enabled 时只读加载 `USER.md` 和 `MEMORY.md`
- Policy enabled 时只读加载今天/昨天的 daily memory
- Read-only identity file policy
- Memory write permission classification
- Memory writes 前的 redaction
- Memory reads 和 writes 的 trace events
- 未来 durable memory updates 的 user approval flow

每个 memory-related iteration 都应包含 behavior 和 safety 两方面测试。

## 17. 记忆工具

两个工具为模型提供直接访问记忆工作区的能力。

### `memory_search`

`memory_search` 对工作区记忆目录（默认为 `memory/`）中的所有文件执行全文搜索。

输入：
- `query`：字符串 — 搜索词
- `limit`：数字（可选，默认 10）— 最多返回的摘录数量

输出：`{ path, excerpt, lineNumber }` 对象数组。每条摘录包含匹配行及前后各三行上下文。

工具搜索 `MEMORY.md`、`USER.md` 和所有 `memory/YYYY-MM-DD.md` 文件。不搜索配置记忆目录以外的内容。

风险级别：低（只读）。

使用场景：模型使用 `memory_search` 在决定写入新记忆前检查某个事实是否已知，或从以前的会话中回忆上下文。

### `memory_get`

`memory_get` 按路径读取特定记忆文件。

输入：
- `path`：字符串 — 工作区记忆目录内的相对路径（例如 `MEMORY.md`、`memory/2026-05-05.md`）

输出：文件完整内容（字符串），或文件不存在时的错误信息。

路径遍历防护：`memory_get` 相对工作区记忆根目录解析路径，拒绝任何逃出记忆目录的路径。绝对路径会被拒绝。

风险级别：低（只读）。

使用场景：`memory_search` 返回相关摘录但需要更多上下文时，模型使用 `memory_get` 读取完整的记忆文件。

## 18. 记忆 Dreaming

记忆 Dreaming 是计划中的后台记忆整合机制。

基本思路：会话结束后，后台进程回顾最近的日记文件和会话 Trace，识别反复出现的事实、决策和偏好，并向用户提出添加到 `MEMORY.md` 的建议供审查。

未来实现的设计原则：

- Dreaming 作为后台任务运行，而非在活跃会话期间运行。
- 只从记忆文件和会话 Trace 读取，从不直接写入。
- 提议的记忆条目作为待处理审批呈现在 CLI 或 Web UI 中。
- 用户在每条提议写入 `MEMORY.md` 前进行审查、编辑或拒绝。
- Dreaming 产生 `memory_dream_completed` Trace 事件，记录提议条目数量。
- 如果 Dreaming 运行没有产生提议，记录 `memory_dream_empty` Trace 事件。

状态：计划中。当前阶段尚未实现。

OpenClaw 对齐：OpenClaw 将记忆 Dreaming 实现为使用专用记忆整合 Skill 的定时 Agent 运行。ArvinClaw 实现此功能时应遵循相同模式。

## 19. 验收标准

MVP memory boundary 成功标准：

- Session memory 通过 session storage 实现。
- Long-term memory 明确不会自动写入。
- Long-term memory file access 有明确的 disabled/read-only policy。
- 设计支持未来 `SOUL.md`、`USER.md`、`MEMORY.md` 和 daily memory files。
- Prompt file loading 被设计为显式 context assembly step。
- Identity 和 memory files 不能绕过 permissions。
- Memory plan 同时用英文和中文记录。
- Memory-related behavior 在实现前有定义好的测试。
- `memory_search` 和 `memory_get` 工具已在本文档中定义，即使尚未实现。

## 20. 相关文档

- [主设计](../product/arvinclaw-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Workspace Files](./workspace-files.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Skill System](./skill-system.zh-CN.md)

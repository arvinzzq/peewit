# OpenClaw 对齐计划

状态：已完成
日期：2026-05-05

English version: [openclaw-alignment.md](./openclaw-alignment.md)

## 1. 目的

Phase 0–10 已将 ArvinClaw 建立为与 OpenClaw 核心架构对齐的可用个人 Agent 平台。

本文档追踪了迭代 1–7 中 ArvinClaw 与 OpenClaw 生产行为之间的剩余差距。所有 18 个差距现已全部关闭。

本文档已归档。新的架构差距或改进应在后续路线图文档中追踪。

## 2. 差距汇总

| # | 差距 | 优先级 | 迭代 | 状态 | 提交 |
|---|---|---|---|---|---|
| 1 | 上下文压缩 | 🔴 高 | 1 | ✅ 已完成 | `df54b1e` |
| 2 | Skill 全文按需加载（`load_skill` 工具） | 🔴 高 | 1 | ✅ 已完成 | `10167ac` |
| 3 | Prompt 模式（full / minimal / none） | 🟡 中 | 1 | ✅ 已完成 | `2e8251c` |
| 4 | `memory_search` 工具 | 🔴 高 | 2 | ✅ 已完成 | `a7a1c5d` |
| 5 | `memory_get` 工具 | 🟡 中 | 2 | ✅ 已完成 | `a7a1c5d` |
| 6 | 额外工作区文件（TOOLS.md、IDENTITY.md、HEARTBEAT.md、BOOTSTRAP.md） | 🟡 中 | 2 | ✅ 已完成 | `fee903d` |
| 7 | 心跳机制 | 🟡 中 | 2 | ✅ 已完成 | `fee903d` |
| 8 | Strict-agentic 执行合约 | 🟡 中 | 3 | ✅ 已完成 | `c9d47f9` |
| 9 | 会话写锁（运行序列化） | 🟡 中 | 3 | ✅ 已完成 | `eb555f5` |
| 10 | Hooks 系统 | 🟡 中 | 3 | ✅ 已完成 | `eb555f5` |
| 11 | 工具 Profile（coding / full / messaging / background） | 🟡 中 | 4 | ✅ 已完成 | `5021b64` |
| 12 | 沙箱执行（工作区边界约束） | 🟡 中 | 4 | ✅ 已完成 | `68befac` |
| 13 | Cron Daemon（`arvinclaw daemon`） | 🟡 中 | 5 | ✅ 已完成 | `6f47106` |
| 14 | TaskFlow（持久跨会话任务图） | 🟢 低 | 6 | ✅ 已完成 | `ebcd52b` |
| 15 | 异步子 Agent（push-based，fork 上下文模式） | 🟢 低 | 6 | ✅ 已完成 | `a7b1fc2` |
| 16 | WebSocket 支持 | 🟢 低 | 7 | ✅ 已完成 | `ee000d4` |
| 17 | Thinking Budget 配置 | 🟢 低 | 7 | ✅ 已完成 | `8967c2e` |
| 18 | 记忆 Dreaming / 记忆晋升 | 🟢 低 | 7 | ✅ 已完成 | `cee3327` |

## 3. 迭代 1 — 上下文与 Prompt

**目标**：停止浪费上下文窗口 Token，并启用 Prompt 模式选择。

### 差距 1：上下文压缩

长对话会溢出模型的上下文窗口。ArvinClaw 目前每轮都传递所有消息，没有任何管理。

OpenClaw 解决方案：`context-engine-maintenance.ts` 在上下文超过阈值时用模型对旧消息进行摘要。摘要替换旧消息并作为系统消息注入。

ArvinClaw 设计：
- 在 `packages/context` 中添加 `compactMessages(messages, modelProvider, options)`
- `CompactionOptions`：`maxMessages`（默认 30）、`keepRecent`（默认 12）、`summarySystemPrompt`
- `AgentRuntimeDependencies.compaction?: Partial<CompactionOptions>` — 可选启用
- 在 `runTurn()` 中每次模型请求前，当消息数超过阈值时调用
- 故障安全：摘要调用失败时使用原始消息

架构文档：[context-compaction.md](../architecture/context-compaction.zh-CN.md)

### 差距 2：Skill 全文按需加载

ArvinClaw 目前将所有 SKILL.md 全文注入每个 Prompt。Skill 数量多时会大量浪费 Token。

OpenClaw 解决方案：只注入紧凑的 Skill 索引（name + description）。模型在需要时调用 `load_skill(name)` 工具获取完整 Skill 说明。

ArvinClaw 设计：
- 在 `packages/tools` 中添加 `createLoadSkillTool(skillFileMap: Map<string, string>)`
- `skillFileMap` 映射 Skill 名称 → 绝对文件路径（已通过 `SkillDefinition.filePath` 提供）
- 工具风险：低。返回文件内容或错误信息。
- CLI 和 Web 在加载 Skill 时将该工具与其他内置工具一同注入
- 上下文组装停止注入 Skill 全文；只有索引（name + description）进入 Prompt

架构文档：[skill-system.md](../architecture/skill-system.zh-CN.md)（更新）

### 差距 3：Prompt 模式

OpenClaw 支持三种 Prompt 渲染模式。ArvinClaw 始终渲染所有段落。

ArvinClaw 设计：
- 在 `packages/context` 的 `ContextAssemblerInput` 中添加 `promptMode: "full" | "minimal" | "none"`
- `none`：完全不发送系统指令
- `minimal`：仅包含 identity 段落
- `full`：所有段落（当前行为，保持默认）
- 通过 `ARVINCLAW_PROMPT_MODE` 环境变量和 `runtime.promptMode` 配置字段暴露

架构文档：[execution-contract.md](../architecture/execution-contract.zh-CN.md)

## 4. 迭代 2 — 记忆

**目标**：赋予 Agent 主动搜索和检索自身记忆的工具。

### 差距 4：`memory_search` 工具

Agent 目前无法查询其记忆。长期记忆被动加载到上下文中，但不可主动搜索。

OpenClaw 解决方案：`memory_search` 工具对记忆文件进行全文搜索，返回相关摘录。

ArvinClaw 设计：
- 在 `packages/tools` 中添加 `createMemorySearchTool(memoryDir: string)`
- 输入：`{ query: string, maxResults?: number }`（默认 5 个结果）
- 搜索 `memoryDir` 中所有 `.md` 文件，分段返回包含查询词的段落
- 返回 `{ results: Array<{ file: string, excerpt: string }> }`
- 工具风险：低
- 当 `config.memory.longTermFiles` 为 `read-only` 或 `write` 时启用

架构文档：[memory-system.md](../architecture/memory-system.zh-CN.md)（更新）

### 差距 5：`memory_get` 工具

Agent 无法按名称读取特定记忆文件。

ArvinClaw 设计：
- 在 `packages/tools` 中添加 `createMemoryGetTool(memoryDir: string)`
- 输入：`{ filename: string }` — 例如 `"MEMORY.md"` 或 `"memory/2026-05-05.md"`
- 验证文件名：无 `..` 路径遍历，必须以 `.md` 结尾
- 返回文件内容或错误信息
- 工具风险：低

### 差距 6：额外工作区文件

OpenClaw 加载 `TOOLS.md`、`IDENTITY.md`、`HEARTBEAT.md`、`BOOTSTRAP.md` 作为启动文件。ArvinClaw 目前只加载 `AGENTS.md` 和 `SOUL.md`。

ArvinClaw 设计：
- 在 `createCliContextAssembler` 的 `workspacePromptFiles` 列表中添加 `TOOLS.md` 和 `IDENTITY.md`
- `TOOLS.md`：存在时加载——描述 Agent 的工具配置说明
- `IDENTITY.md`：存在时加载——覆盖/扩展 Agent 身份
- `BOOTSTRAP.md`：第一次会话时存在则加载——一次性启动说明
- `HEARTBEAT.md`：由 Agent 读写用于心跳状态（见差距 7）

### 差距 7：心跳机制

OpenClaw 通过 `HEARTBEAT.md` 支持周期性心跳，用于后台监控。

ArvinClaw 设计（最小版本）：
- 工作区中存在 `HEARTBEAT.md` 时加载（启动上下文）
- Agent 可通过 `write_file` 向该路径写入心跳更新
- 后续可添加专用的 `update_heartbeat` 工具以支持更丰富的语义
- 完整的 Daemon 心跳循环是 Cron Daemon 的一部分（迭代 5）

## 5. 迭代 3 — 执行

**目标**：更严格的执行规范、并发安全和可扩展 Hooks。

### 差距 8：Strict-Agentic 执行合约

OpenClaw 的 `strict-agentic` 执行合约提升了停滞检测严格性，并为兼容模型启用 `update_plan`。

ArvinClaw 设计：
- 在 `AgentRuntimeDependencies` 中添加 `executionContract: "default" | "strict-agentic"`
- `strict-agentic` 行为：
  - `maxPlanningStallRetries` 默认值从 2 提升到 3
  - 在系统提示词中将 `update_todos` 作为主要进度机制进行推广
- 通过 `ARVINCLAW_EXECUTION_CONTRACT` 环境变量和配置暴露

架构文档：[execution-contract.md](../architecture/execution-contract.zh-CN.md)

### 差距 9：会话写锁

同一会话的并发 `runTurn()` 调用可能在 JSONL 写操作上产生竞争，导致 Trace/消息记录交错。

ArvinClaw 设计：
- 在 `packages/core` 或 `packages/sessions` 中添加 `SessionMutex` 类
- `async acquire(sessionId): Promise<() => void>` — 返回释放函数
- `AgentRuntime` 在轮次开始前获取会话锁，完成后释放
- 创建 Runtime 的适配器需一致传递会话 ID

架构文档：[run-queue.md](../architecture/run-queue.md)（更新）

### 差距 10：Hooks 系统

OpenClaw 为扩展提供了多个 Hook 点。ArvinClaw 目前没有 Hooks。

ArvinClaw 设计：
- 在 `packages/core` 中添加 `AgentHooks` 接口：
  ```ts
  export interface AgentHooks {
    beforeTurn?: (input: AgentRuntimeInput) => Promise<void>;
    afterTurn?: (events: RuntimeEvent[]) => Promise<void>;
    beforeToolCall?: (call: ModelToolCall) => Promise<void | "abort">;
    afterToolCall?: (call: ModelToolCall, result: ToolExecutionResult) => Promise<void>;
    onCompaction?: (before: number, after: number) => Promise<void>;
  }
  ```
- 在 `AgentRuntimeDependencies` 中添加 `hooks?: AgentHooks`
- Hook 在 `runTurn()` 的相应节点被调用
- Hook 错误记录到 Trace 但不导致运行失败
- `beforeToolCall` 返回 `"abort"` 可阻止工具调用执行

架构文档：[hooks.md](../architecture/hooks.zh-CN.md)

## 6. 迭代 4 — 工具系统

**目标**：结构化工具能力集合和运行时边界强制执行。

### 差距 11：工具 Profile

OpenClaw 提供工具 Profile（`coding`、`full`、`messaging`），决定会话中可用的工具。

ArvinClaw 设计：
- 在 `packages/adapters` 或 `packages/tools` 中添加 `ToolProfile` 类型
- Profile：`coding`（文件 + Shell）、`full`（所有工具）、`messaging`（无文件/Shell）、`background`（仅文件）
- `getToolsForProfile(profile, allTools)` 返回该 Profile 的工具子集
- CLI 默认 `full`；后台任务默认 `background`
- 通过 `ARVINCLAW_TOOL_PROFILE` 环境变量可配置

架构文档：[tool-profiles.md](../architecture/tool-profiles.zh-CN.md)

### 差距 12：沙箱执行

Shell 工具目前没有运行时边界。模型可以在文件系统任意位置执行命令。

ArvinClaw 设计：
- 向 Shell 工具配置添加 `sandboxed?: boolean` 选项
- 当 `sandboxed: true` 时：将 `cwd` 设为 `workspaceRoot`，拒绝以 `..` 或工作区外 `/` 开头的路径
- `memory_get` 已验证路径遍历
- 在系统提示词的"Sandbox"段落中强化执行边界（目前仅为文字说明）

架构文档：[sandboxing.md](../architecture/sandboxing.zh-CN.md)（更新）

## 7. 迭代 5 — 后台自动化

**目标**：无前台会话的定时执行。

### 差距 13：Cron Daemon

`arvinclaw run` 执行单个任务，没有循环调度器。

ArvinClaw 设计：
- `arvinclaw daemon` 命令 — 启动长期运行进程
- 从工作区的 `tasks/*.task.json` 读取任务定义
- 每个任务文件可包含 `cron` 字段（cron 表达式，例如 `"0 18 * * *"`）
- Daemon 计算下次运行时间，到时执行任务
- 使用 `BackgroundApprovalResolver` 进行无人值守执行
- 在 `JsonlTaskStore` 中持久化运行记录
- 信号安全：`SIGTERM` / `SIGINT` 优雅停止正在运行的任务

架构文档：[background-automation.md](../architecture/background-automation.zh-CN.md)（更新）

## 8. 迭代 6 — 多 Agent

**目标**：持久任务协调和非阻塞子 Agent 执行。

### 差距 14：TaskFlow

`update_todos` 只追踪单轮内的进度，没有持久的跨会话任务图。

OpenClaw 拥有具备 7 种状态、父子关系和 SQLite 持久化的 `TaskRecord` 和 `TaskFlow`。

ArvinClaw 设计：
- `packages/taskflow` — 新包
- `TaskRecord`：`{ id, runtime, task, status, progressSummary, terminalSummary }`
- `TaskFlow`：`{ id, goal, currentStep, blockedSummary, stateJson, parentId?, status }`
- 状态：`queued | running | waiting | blocked | succeeded | failed | cancelled | lost`
- 存储：初期 JSONL，后续迭代改为 SQLite
- CLI 命令：`arvinclaw taskflow list`、`arvinclaw taskflow show <id>`、`arvinclaw taskflow cancel <id>`

架构文档：[task-flow.md](../architecture/task-flow.zh-CN.md)

### 差距 15：异步子 Agent

`spawn_subagent` 目前是同步的——父 Agent 阻塞等待子 Agent 完成。

OpenClaw `sessions_spawn` 是 push-based：主 Agent 继续运行，子 Agent 并行执行，完成后异步推送结果。

ArvinClaw 设计：
- 添加 `spawn_subagent_async` 工具变体，在后台任务中启动子 Agent
- 立即返回 `{ taskId }`
- 子 Agent 完成后将结果写入 `TaskRecord`
- 父 Agent 可通过 `check_subagent(taskId)` 轮询或接收完成回调
- 上下文模式：`isolated`（新鲜上下文——当前行为）+ `fork`（复制父 Agent Transcript）

架构文档：[multi-agent-runtime.md](../architecture/multi-agent-runtime.zh-CN.md)（更新）

## 9. 迭代 7 — 协议与高级功能

**目标**：更丰富的传输支持、模型推理控制和记忆生命周期管理。

### 差距 16：WebSocket 支持

Web 适配器使用 SSE（单向），WebSocket 支持双向通信，更适合审批流程和取消操作。

ArvinClaw 设计：
- 在 Hono 服务器添加 WebSocket 端点：`GET /ws/:sessionId`
- 服务端以 JSON 帧发送运行时事件
- 客户端以 JSON 帧发送用户消息和审批决策
- SSE 端点保留以兼容
- 使用 Hono 的 WebSocket 升级支持实现

架构文档：[gateway.md](../architecture/gateway.zh-CN.md)（更新）

### 差距 17：Thinking Budget

OpenClaw 为 Anthropic 模型暴露了可配置的推理深度。

ArvinClaw 设计：
- 在模型配置中添加 `thinkingBudget?: "off" | "minimal" | "low" | "medium" | "high" | "max" | "adaptive"`
- `AnthropicProvider` 将 Budget 映射到 Anthropic 扩展思考 API 参数
- 仅适用于支持扩展思考的 Anthropic 模型
- 默认值：`"adaptive"`（模型自行决定）

架构文档：[execution-contract.md](../architecture/execution-contract.zh-CN.md)（更新）

### 差距 18：记忆 Dreaming

OpenClaw 支持后台记忆整合：Agent 回顾最近的日记并将关键事实晋升到 `MEMORY.md`。

ArvinClaw 设计：
- Dreaming 是一种特殊的后台任务：`arvinclaw run --dream`
- 读取最近的 `memory/YYYY-MM-DD.md` 文件和 `MEMORY.md`
- 生成整合摘要并追加或重写 `MEMORY.md`
- 可通过 Cron Daemon 调度
- 所有写入操作遵循 `memory.longTermFiles: "write"` 策略

架构文档：[memory-system.md](../architecture/memory-system.zh-CN.md)（更新）

## 10. 非目标

- 不保证与 OpenClaw 内部实现完全一致
- 无企业 SaaS 假设
- 不自动信任第三方代码
- 不进行记忆或会话的云同步
- 无多用户账户系统

## 11. 相关文档

- [研究：OpenClaw 实现笔记](../research/openclaw-implementation-notes.zh-CN.md)
- [架构：OpenClaw 架构映射](../architecture/openclaw-architecture-map.zh-CN.md)
- [决策：OpenClaw 对齐而非相同](../decisions/0002-openclaw-aligned-not-identical.zh-CN.md)
- [路线图](../roadmap/overview.zh-CN.md)

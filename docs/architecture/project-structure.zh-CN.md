# 项目结构

状态：活跃
日期：2026-05-11

English version: [project-structure.md](./project-structure.md)

## 1. 目的

Vole 使用轻量 monorepo，是为了让项目可以从 CLI MVP 演进到多入口 Agent 平台，而不需要重写核心架构。

核心规则：

Agent Core 拥有 Agent 行为。用户界面只负责把用户输入输出适配到核心。

这很重要，因为 Vole 预期先支持 CLI，然后支持 Web UI、桌面应用、消息平台和后台自动化。如果第一版 CLI 拥有太多业务逻辑，后续每个入口都需要复制或反向拆解这些行为。

## 2. 当前布局

```text
apps/
  cli/          终端 adapter（Ink + readline）
  web/          Web adapter（Hono + SSE + WebSocket）
packages/
  core/         Agent runtime 和事件循环
  config/       配置加载与验证
  context/      Prompt 和上下文组装
  models/       模型 provider 抽象与实现
  tools/        工具定义和执行
  skills/       Skill 发现、解析和生命周期
  permissions/  风险分类和批准策略
  sessions/     会话和 trace 持久化
  gateway/      跨 adapter 的会话注册中心
  adapters/     能力常量和工具配置过滤
  taskflow/     跨会话任务图持久化
  scheduler/    后台任务运行器和 cron 调度器
docs/
  architecture/
  roadmap/
  plans/
  product/
  decisions/
  research/
scripts/
tests/
skills/
```

## 3. 目录职责

### `apps/cli`

CLI 负责终端交互：

- 解析 CLI 命令，路由到 `chat`、`run`、`sessions`、`tasks`、`skills`、`daemon`、`taskflow`
- 通过 Ink（React-based 终端 UI）渲染消息、轨迹和权限提示
- 从终端读取用户确认
- 组装所有运行时依赖并创建 `AgentRuntime`

CLI 不应负责 Agent 规划、工具选择、权限决策、Skill 加载、模型 provider 逻辑或会话持久化规则。

### `apps/web`

Web 应用负责浏览器端交互：

- HTTP REST API 管理会话生命周期（`POST /api/sessions`、`GET /api/sessions`）
- SSE 流式传输 turn 事件（`POST /api/sessions/:id/turns`）
- WebSocket 端点（`/ws/:id`）用于双向会话通信
- 审批解决端点（`POST /api/sessions/:id/approvals`）
- Gateway 会话端点（`GET /api/gateway/sessions`）

Web adapter 与 CLI 共享同一个 `AgentRuntime`，不重新实现 Agent 行为。

### `packages/core`

Core 包负责 Agent runtime：

- Agent Loop
- 任务编排
- 对话 turn 处理
- 工具调用协调
- Trace event 创建
- 共享领域类型

其他入口应该可以使用 `packages/core`，而不导入 CLI 代码。

### `packages/config`

Config 包负责配置加载、验证、优先级和脱敏：

- 内置默认值
- 用户配置加载
- 项目配置加载
- 环境变量覆盖
- Effective config 创建
- Secret presence checks
- Redacted config views

其他包应接收已验证配置或已经配置好的依赖。它们不应该各自读取配置文件或环境变量。

### `packages/context`

Context 包负责 prompt 和 context assembly：

- Base system instruction assembly
- Runtime metadata projection
- Skill index projection
- Tool definition projection
- Permission guidance projection
- Session resume context projection
- 后续 phases 的 workspace file loading
- 后续 phases 的 context compaction

Prompt assembly 应可测试并与 adapter 无关。CLI 和 Web UI 不应直接构建 prompts。

### `packages/models`

Models 包负责模型 provider 抽象和实现：

- `ModelProvider` 接口
- OpenAI-compatible provider
- 未来 Anthropic、Gemini、Ollama、本地模型 adapter

Core 应依赖 provider 接口，而不是厂商 SDK 细节。

### `packages/tools`

Tools 包负责工具定义和执行包装：

- Tool 接口
- Tool registry
- 文件工具
- Shell 工具
- Web 搜索工具
- 网页读取工具

工具描述自己能做什么，但不决定某个动作是否允许。权限决策属于 `packages/permissions`。

### `packages/permissions`

Permissions 包负责风险分级和批准策略：

- Low、Medium、High、Blocked 风险等级
- Permission policy evaluation
- 自主模式交互
- Approval request 结构

这个包应与 UI 无关。它可以说“这个动作需要确认”，但由 CLI 或 Web UI 决定如何询问用户。

### `packages/skills`

Skills 包负责本地 Skill 发现和提示词集成：

- 内置 Skill 加载
- 项目 Skill 加载
- 用户 Skill 加载
- Skill 优先级
- `SKILL.md` 解析
- 用于 prompt assembly 的 Skill 摘要

Skills 可以指导 Agent，但不能绕过工具或权限。

### `packages/sessions`

Sessions 包负责持久化：

- Session records
- Trace records
- Conversation history
- `InMemorySessionStore`：用于测试和临时会话
- `JsonlSessionStore`：文件持久化会话（每个会话独立目录，含 `session.json`、`messages.jsonl`、`trace.jsonl`）

接口应为未来后端留下替换空间，不影响调用方。

### `packages/gateway`

Gateway 包负责跨 adapter 的会话协调：

- `SessionGateway` 进程内存注册中心，跟踪当前进程内的活跃会话
- `register`、`unregister`、`touch`、`get`、`list`、`listByAdapter` 操作
- `GatewaySession` 记录：含 adapter 名称、能力和活动时间戳

每个 adapter 创建进程级单例并在会话启动时注册。这是 Phase 10 多入口路由的基础。

### `packages/adapters`

Adapters 包负责能力声明和工具配置过滤：

- `AdapterCapabilities` 接口：`streaming`、`approvalPrompts`、`background`
- 标准常量：`CLI_CAPABILITIES`、`WEB_CAPABILITIES`、`BACKGROUND_CAPABILITIES`
- `ToolProfile` 类型：`coding`、`full`、`messaging`、`background`
- `filterToolsByProfile(tools, profile)` 按使用场景限制工具集

该包无运行时依赖，只导出纯类型定义和常量。

### `packages/taskflow`

Taskflow 包负责跨会话任务图持久化：

- `TaskRecord` 包含完整状态生命周期：`queued → running → waiting → blocked → succeeded/failed/cancelled/lost`
- `TaskRuntime` 标签：`subagent`、`background`、`cli`、`cron`、`web`
- 通过 `parentId` 支持父子任务关系
- `JsonlTaskFlowStore` 基于单个 JSONL 文件
- 提供 `list`、`get`、`create`、`update` 操作

这与会话内的 `update_todos` 工具不同。TaskFlow 记录跨会话持久化，代表 Agent 的持久任务图。

### `packages/scheduler`

Scheduler 包负责后台任务执行：

- `TaskDefinition` 格式，从 `*.task.json` 文件加载
- `JsonlTaskStore` 记录每次任务运行历史
- `BackgroundApprovalResolver`：`auto` 模式自动批准，否则自动拒绝（无用户在场）
- `CronScheduler`：每分钟检查 cron 表达式，对到期任务调用 runner
- `matchesCron(expr, date)` 工具函数，支持标准 5 字段 cron 表达式

Scheduler 在 CLI adapter 层与 `AgentRuntime` 组合。它不拥有 Agent 行为。

### `docs`

Docs 目录负责产品和学习文档：

- 产品设计
- Roadmap
- 架构说明
- 未来实现计划

文档是产品目标的一部分。Vole 应该既能运行，也能用于学习。

### `skills`

根目录 `skills` 存放项目本地 Skills。它们应覆盖同名用户 Skill 和内置 Skill。

## 4. 依赖方向

依赖从 adapter 层向内流向核心层：

```text
apps/cli ──────────────────────────────────────────┐
apps/web ──────────────────────────────────────────┤
         │                                          │
         ├──▶ @vole/core ◀── @vole/scheduler
         │         │
         │         ├──▶ @vole/context ──▶ @vole/models
         │         ├──▶ @vole/models
         │         ├──▶ @vole/permissions
         │         └──▶ @vole/tools
         │
         ├──▶ @vole/config
         ├──▶ @vole/sessions
         ├──▶ @vole/gateway ──▶ @vole/adapters
         ├──▶ @vole/adapters
         ├──▶ @vole/skills
         ├──▶ @vole/taskflow
         └──▶ @vole/scheduler ──▶ @vole/core（仅类型）
```

强制边界 — 以下规则不可违反：

| 包 | 不能导入 |
| --- | --- |
| `core` | `apps/cli`、`apps/web`、任何 adapter 代码 |
| `context` | `core`、`permissions`、`tools` |
| `models` | `core`、`context`、`tools` |
| `tools` | `core`、`context`、`permissions` |
| `permissions` | 任何内部包 |
| `sessions` | 任何内部包 |
| `adapters` | 任何内部包 |

`apps/` 层负责把所有依赖组装在一起。所有内部包保持与入口无关。

## 5. Adapter 模式

每个用户入口最终都应成为同一个 core runtime 上的 adapter。

例子：

- CLI adapter：终端输入输出、终端确认提示
- Web adapter：HTTP 或 WebSocket 输入、浏览器轨迹渲染、浏览器批准 UI
- Desktop adapter：本地应用壳、原生通知、OS 集成
- Messaging adapter：消息事件、渠道格式、异步批准
- Background adapter：定时事件、已保存任务定义、持久轨迹

Adapter 可以有不同呈现方式和交互节奏，但不应重新定义 Agent 行为。

## 6. 为什么不是单包

单个 `src/` 包在前几个文件时更快，但很容易过早模糊边界：

- CLI 关注点泄漏进核心逻辑。
- 工具逻辑和权限提示混在一起。
- 模型厂商细节散落到 runtime。
- 后续 Web UI 需要重构，而不是自然扩展。

轻量 monorepo 在避免这些问题的同时，不会引入沉重发布体系。

## 7. 为什么不是重型 monorepo

Vole 不应该一开始就引入复杂发布、release 自动化或包治理。

MVP 需要的是清晰边界，而不是仪式感。只有当项目真的有压力时，再增加更多工程工具。

## 8. Phase 0 验收标准

Phase 0 完成标准：

- 约定目录结构存在。
- 根 README 解释 Vole 的产品目标和学习目标。
- 主设计文档链接到 Roadmap。
- 本文档解释各包职责。
- 初始包结构使 CLI 可以接入，而不让 Agent Core 依赖 CLI。

## 9. 相关文档

- [主设计](../product/vole-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [CLI Adapter](./cli-adapter.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)

# 项目结构

状态：草案
日期：2026-05-02

English version: [project-structure.md](./project-structure.md)

## 1. 目的

ArvinClaw 使用轻量 monorepo，是为了让项目可以从 CLI MVP 演进到多入口 Agent 平台，而不需要重写核心架构。

核心规则：

Agent Core 拥有 Agent 行为。用户界面只负责把用户输入输出适配到核心。

这很重要，因为 ArvinClaw 预期先支持 CLI，然后支持 Web UI、桌面应用、消息平台和后台自动化。如果第一版 CLI 拥有太多业务逻辑，后续每个入口都需要复制或反向拆解这些行为。

## 2. 建议布局

```text
apps/
  cli/
packages/
  core/
  context/
  models/
  tools/
  skills/
  permissions/
  sessions/
docs/
  architecture/
  roadmap/
  superpowers/specs/
skills/
```

## 3. 目录职责

### `apps/cli`

CLI 应只负责终端交互：

- 解析 CLI 命令
- 运行 `arvinclaw chat`
- 运行未来的 `arvinclaw run "<goal>"`
- 渲染消息、轨迹和权限提示
- 从终端读取用户确认

CLI 不应负责 Agent 规划、工具选择、权限决策、Skill 加载、模型 provider 逻辑或会话持久化规则。

### `packages/core`

Core 包负责 Agent runtime：

- Agent Loop
- 任务编排
- 对话 turn 处理
- 工具调用协调
- Trace event 创建
- 共享领域类型

其他入口应该可以使用 `packages/core`，而不导入 CLI 代码。

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
- 未来 memory storage adapters

第一版实现可以很简单，但接口应为未来后端留空间。

### `docs`

Docs 目录负责产品和学习文档：

- 产品设计
- Roadmap
- 架构说明
- 未来实现计划

文档是产品目标的一部分。ArvinClaw 应该既能运行，也能用于学习。

### `skills`

根目录 `skills` 存放项目本地 Skills。它们应覆盖同名用户 Skill 和内置 Skill。

## 4. 依赖方向

依赖应大致向内流动：

```text
apps/* -> packages/core -> packages/{models,tools,skills,permissions,sessions}
```

重要边界：

- `packages/core` 不能导入 `apps/cli`。
- `packages/models` 不能导入 `apps/cli`。
- `packages/tools` 不能导入 `apps/cli`。
- `packages/permissions` 不能导入 `apps/cli`。
- `packages/skills` 不能导入 `apps/cli`。
- `packages/sessions` 不能导入 `apps/cli`。

CLI 可以依赖 core 包，但 core 包必须和入口无关。

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

ArvinClaw 不应该一开始就引入复杂发布、release 自动化或包治理。

MVP 需要的是清晰边界，而不是仪式感。只有当项目真的有压力时，再增加更多工程工具。

## 8. Phase 0 验收标准

Phase 0 完成标准：

- 约定目录结构存在。
- 根 README 解释 ArvinClaw 的产品目标和学习目标。
- 主设计文档链接到 Roadmap。
- 本文档解释各包职责。
- 初始包结构使 CLI 可以接入，而不让 Agent Core 依赖 CLI。

## 9. 相关文档

- [主设计](../superpowers/specs/2026-05-02-arvinclaw-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

# Vole

> 个人通用 Agent — 受 OpenClaw 启发，TypeScript 实现，真实可用。

[![npm](https://img.shields.io/npm/v/vole-agent?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/vole-agent)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Tests](https://img.shields.io/badge/tests-411%20passing-22c55e)](#开发)

English version: [README.md](./README.md)

---

## 项目是什么？

Vole 是一个从零开始用 TypeScript 构建的个人通用 Agent。

它既是**真实可用的产品**，也是**架构学习项目**。每一个模块——Agent 循环、工具执行、权限策略、上下文组装、会话存储、流式输出、多 Agent 协调——都经过有意设计、详细文档记录和充分测试。参考架构来自 [OpenClaw](https://openclaw.ai)。

---

## 功能特性

### Agent 核心
- **Agent 循环** — 上下文组装 → 模型推理 → 工具执行 → 流式回复 → 持久化
- **流式输出** — 逐 Token 输出，Web 端 SSE，CLI 端渐进式文本输出
- **规划停滞检测** — 检测纯规划轮次并通过重试注入强制立即行动
- **轮次内任务追踪** — 模型可调用的 `update_todos`（等同于 OpenClaw `update_plan`）
- **子 Agent 派生** — `spawn_subagent`（同步阻塞）和 `spawn_subagent_async`（即发即忘）
- **上下文压缩** — 上下文即将溢出前自动对历史对话进行摘要
- **执行契约** — `default` 和 `strict-agentic` 两种规划执行纪律模式
- **Hooks** — `beforeTurn`、`beforeToolCall`、`onCompaction` 等扩展点
- **会话互斥锁** — 每会话写锁，保障并发安全

### 工具与权限
- **内置工具** — `read_file`、`list_directory`、`write_file`、`edit_file`、`run_shell`、`read_web_page`、`search_files`
- **记忆工具** — `memory_search`、`memory_get`、`append_daily_memory`、`update_heartbeat`
- **技能加载** — `load_skill` 按需加载完整 SKILL.md 正文
- **基于风险的权限策略** — low / medium / high / blocked；`observe` / `confirm` / `auto` 模式
- **工具 Profile** — `coding`、`full`、`messaging`、`background` 四种会话能力集合
- **沙箱限制** — Shell 工具可限制在工作区根目录，拒绝路径穿越

### 上下文与记忆
- **XML 段落系统提示词** — identity、runtime、tooling、safety、skills、workspace 六个段落
- **Prompt Caching** — Anthropic `cache_control: ephemeral` 缓存系统块
- **工作区启动文件** — `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`TOOLS.md`、`HEARTBEAT.md`、`MEMORY.md`、`memory/YYYY-MM-DD.md`
- **会话持久化** — JSONL 格式的消息和 Trace 存储，支持压缩边界

### 技能（Skills）
- **SKILL.md 格式** — `name` + `description` frontmatter；通过 `load_skill` 按需加载完整正文
- **三来源优先级** — 工作区 > 用户（`~/.vole/skills/`）> 内置
- **生命周期管理** — 通过 CLI 安装、启用、禁用、信任、查看

### 适配器
- **CLI** — 终端适配器，支持流式输出、交互式审批提示、slash 命令和 daemon
- **Web UI** — Hono API + React 前端；会话列表、流式聊天、内联审批 Modal
- **跨适配器会话** — CLI 和 Web 共享同一个 `JsonlSessionStore`
- **会话网关** — `packages/gateway` 跨适配器追踪活跃会话

### 后台自动化
- **一次性任务** — `vole run "<目标>" [--mode auto|confirm]`
- **Cron Daemon** — `vole daemon` 从 `tasks/*.task.json` 运行定时任务
- **心跳机制** — daemon 在任务开始/结束时写入 `HEARTBEAT.md`；agent 可调用 `update_heartbeat`
- **TaskFlow** — 持久化跨会话任务图，支持 8 种状态和父子关系
- **记忆整理** — `vole run --dream` 将日记文件整合写入 `MEMORY.md`

### 模型 Provider
- **OpenAI 兼容** — 遵循 OpenAI chat completions API 的任何服务（OpenAI、OpenRouter、Ollama 等）
- **Anthropic** — 原生 SDK，支持 Prompt Caching、流式输出和扩展思考
- **思考预算** — `off` / `minimal` / `low` / `medium` / `high` / `max` / `adaptive`

---

## 快速开始

### 安装（终端用户）

```bash
npm install -g vole-agent
vole chat
```

首次运行时，Vole 会提示配置 API Key。推荐写入 `~/.vole/config.json`：

```json
{ "apiKey": "sk-ant-..." }
```

也可以通过环境变量配置（`ANTHROPIC_API_KEY`、`OPENROUTER_API_KEY` 或 `VOLE_API_KEY`）。

### 从源码运行（贡献者）

**环境要求：** Node.js ≥ 22，pnpm

```bash
git clone https://github.com/your-username/vole
cd vole
pnpm install
cp .env.example .env   # 填入 API Key
```

> **`.env` 的替代方案**：`~/.vole/config.json` 会自动加载，同样可用于配置 API Key（例如 `{ "apiKey": "sk-ant-..." }`）。如果不想为每个项目单独维护 `.env` 文件，可以使用此方式。

OpenRouter 最简配置：

```bash
OPENROUTER_API_KEY=sk-or-...
VOLE_MODEL=anthropic/claude-3-haiku
```

或直接使用 Anthropic：

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**开始聊天**（无需构建）：

```bash
pnpm cli -- chat
```

---

## 使用方式

### CLI

`pnpm cli --` 直接从源码运行，开发阶段无需构建。

```bash
pnpm cli -- chat                           # 交互式聊天
pnpm cli -- chat --resume                  # 恢复最近会话
pnpm cli -- chat --session <id>            # 命名会话
pnpm cli -- run "<目标>"                   # 一次性后台任务（confirm 模式）
pnpm cli -- run "<目标>" --mode auto       # 自动批准 low/medium 风险工具
pnpm cli -- run --dream                    # 将日记合并进 MEMORY.md
pnpm cli -- sessions                       # 列出所有会话
pnpm cli -- tasks                          # 列出最近后台任务运行记录
pnpm cli -- skills                         # 列出已加载技能（含信任状态）
pnpm cli -- skills install <path>          # 从 .md 文件安装技能
pnpm cli -- skills trust <name>            # 标记技能为已信任
pnpm cli -- daemon                         # 启动 Cron 调度守护进程
pnpm cli -- web                            # 打开 Web 界面（需先构建 web）
pnpm cli -- taskflow list                  # 列出 TaskFlow 记录
pnpm cli -- taskflow show <id>
pnpm cli -- taskflow cancel <id>
```

### Web UI

```bash
# 开发模式（热重载）
pnpm --filter @vole/web run dev   # Hono 在 :3120，Vite 在 :5173

# 已安装（npm install -g vole-agent）
vole web                           # 打开 http://localhost:3120
pnpm cli -- web                   # 同上，从源码运行
```

在浏览器打开 `http://localhost:5173`（开发）或 `http://localhost:3120`（已安装）。创建或恢复会话、发送消息、查看流式响应、中断进行中的轮次、在浏览器中审批工具操作。

REST + SSE API：

```
POST   /api/sessions              创建或恢复会话
GET    /api/sessions              列出所有会话
POST   /api/sessions/:id/turns    运行轮次 — 响应是 runtime 事件的 SSE 流
POST   /api/sessions/:id/approvals 解析待处理工具审批
GET    /api/gateway/sessions      当前进程中的活跃会话
GET    /ws/:id                    WebSocket — SSE 的双向替代方案
```

---

## 架构

Vole 是包含 12 个 packages 和 2 个适配器应用的 pnpm monorepo，组织为四个严格分层。核心层不向上依赖适配器，无循环依赖。

### 包结构

```
适配器层
  apps/cli/          终端适配器 — 组装所有依赖，驱动交互循环
  apps/web/          Hono + React 适配器 — REST/SSE/WebSocket，审批 Modal

基础设施层（无状态服务与存储）
  packages/config/       EffectiveConfig，环境变量加载，Provider 快捷方式，脱敏
  packages/sessions/     JSONL 消息 + Trace 存储，会话互斥锁，压缩边界
  packages/skills/       SKILL.md 解析器，SkillLoader（三来源），SkillManager 生命周期
  packages/scheduler/    CronScheduler，BackgroundApprovalResolver，writeHeartbeat
  packages/taskflow/     JsonlTaskFlowStore — 持久化跨会话任务图
  packages/gateway/      SessionGateway — 进程内活跃会话注册表
  packages/adapters/     AdapterCapabilities，ToolProfile，filterToolsByProfile

Agent 核心层（Turn 编排）
  packages/core/         AgentRuntime，17 种事件异步生成器，Hooks，spawn_subagent
  packages/context/      DefaultContextAssembler，XML 段落，PromptMode，compactMessages
  packages/permissions/  DefaultPermissionPolicy — 风险 × 自主模式 → allow/ask/deny
  packages/tools/        所有内置工具，沙箱限制，记忆工具

模型 Provider 层（厂商抽象）
  packages/models/       OpenAICompatibleProvider，AnthropicProvider，流式，思考预算
```

### 依赖规则

- **适配器** 拥有所有连接逻辑——它们创建 `AgentRuntime` 并注入全部依赖。
- **`core`** 仅依赖 `context`、`permissions`、`tools` 和 `ModelProvider` 接口，不导入 apps 或基础设施包。
- **基础设施包** 是独立的，不导入 `core`。
- **`models`** 是最底层包，不知道任何 agent 逻辑。

### 包文档

每个包都有详细的 README，涵盖架构概述、核心概念、实现原理和设计决策。

| 包 | 职责 | 文档 |
|---|---|---|
| `packages/core` | Agent 循环、事件系统、Hooks、Subagent 派生 | [README](./packages/core/README.zh-CN.md) |
| `packages/context` | 系统提示组装、PromptMode、compactMessages | [README](./packages/context/README.zh-CN.md) |
| `packages/models` | ModelProvider、Anthropic + OpenAI 兼容、流式 | [README](./packages/models/README.zh-CN.md) |
| `packages/tools` | 内置工具、沙箱限制、记忆工具 | [README](./packages/tools/README.zh-CN.md) |
| `packages/permissions` | 基于风险的权限策略、自主模式 | [README](./packages/permissions/README.zh-CN.md) |
| `packages/sessions` | JSONL 会话和 Trace 存储、重放、压缩 | [README](./packages/sessions/README.zh-CN.md) |
| `packages/skills` | SKILL.md 解析器、SkillLoader、SkillManager 生命周期 | [README](./packages/skills/README.zh-CN.md) |
| `packages/adapters` | AdapterCapabilities、ToolProfile、filterToolsByProfile | [README](./packages/adapters/README.zh-CN.md) |
| `packages/config` | 配置加载、环境变量、Provider 快捷方式、脱敏 | [README](./packages/config/README.zh-CN.md) |
| `packages/scheduler` | CronScheduler、BackgroundApprovalResolver、writeHeartbeat | [README](./packages/scheduler/README.zh-CN.md) |
| `packages/taskflow` | 持久化跨会话任务图、TaskRecord | [README](./packages/taskflow/README.zh-CN.md) |
| `packages/gateway` | SessionGateway — 跨适配器活跃会话注册表 | [README](./packages/gateway/README.zh-CN.md) |

---

## 学习

Vole 也是一个架构学习项目。`docs/learning/` 目录包含 15 篇双语模块文档，覆盖每一个包——设计决策、实现走读、OpenClaw 对齐分析和复习问题。

建议从**[学习指南](./docs/learning/guide.zh-CN.md)**开始了解推荐阅读顺序，也可以直接跳到任意模块。

**阶段一 — 心智模型**

| 文档 | 主题 |
|---|---|
| [01 — Agent Loop 概念](./docs/learning/01-concepts.zh-CN.md) | 全局视角：Agent 循环是什么，各部分如何组合 |

**阶段二 — 核心循环**

| 文档 | 主题 |
|---|---|
| [02 — 核心循环代码](./docs/learning/02-core.zh-CN.md) | `AgentRuntime`、17 种事件异步生成器、停滞检测 |

**阶段三 — 基础层模块**

| 文档 | 主题 |
|---|---|
| [03 — Config](./docs/learning/03-config.zh-CN.md) | 环境变量加载、三层合并、`EffectiveConfig`、脱敏 |
| [04 — Models](./docs/learning/04-models.zh-CN.md) | `ModelProvider`、流式输出、Anthropic vs OpenAI 兼容 |
| [05 — Permissions](./docs/learning/05-permissions.zh-CN.md) | 风险 × 自主模式 → allow / ask / deny / block |
| [06 — Tools](./docs/learning/06-tools.zh-CN.md) | 工具注册、沙箱、工作区边界、结果类型 |
| [07 — Context](./docs/learning/07-context.zh-CN.md) | XML 段落、提示词模式、`compactMessages`、缓存提示 |
| [08 — Sessions](./docs/learning/08-sessions.zh-CN.md) | JSONL 追加写、`#replay`、压缩边界、互斥锁 |
| [09 — Taskflow](./docs/learning/09-taskflow.zh-CN.md) | `update_todos`、`TodoItem` 状态机、`JsonlTaskFlowStore` |
| [10 — Skills](./docs/learning/10-skills.zh-CN.md) | 三来源加载、渐进式披露、`SkillManager` |
| [11 — Scheduler](./docs/learning/11-scheduler.zh-CN.md) | `CronScheduler`、`BackgroundApprovalResolver`、`writeHeartbeat` |

**阶段四 — 扩展系统**

| 文档 | 主题 |
|---|---|
| [12 — Adapters](./docs/learning/12-adapters.zh-CN.md) | `AdapterCapabilities`、工具 Profile、`filterToolsByProfile` |
| [13 — Gateway](./docs/learning/13-gateway.zh-CN.md) | 进程内会话注册表、`touch`、存在 vs 历史 |

**阶段五 — 系统综合**

| 文档 | 主题 |
|---|---|
| [14 — CLI](./docs/learning/14-cli.zh-CN.md) | 所有包的组装点；`CliChatSession`、`sendMessage` |
| [15 — Web](./docs/learning/15-web.zh-CN.md) | `WebApprovalResolver` Promise 桥接、SSE vs WebSocket、两层存储 |

所有学习文档均有英文和简体中文两个版本。

---

## 配置

所有设置均为可选，Vole 提供安全的默认值。

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 使用 Anthropic Provider（claude-haiku-4-5） | — |
| `OPENROUTER_API_KEY` | 使用 OpenRouter（需配合 `VOLE_MODEL`） | — |
| `VOLE_API_KEY` | 通用 API Key 覆盖 | — |
| `VOLE_BASE_URL` | Provider Base URL | `https://api.openai.com/v1` |
| `VOLE_MODEL` | 模型名称 | `gpt-4.1-mini` |
| `VOLE_DEFAULT_MODE` | 自主模式：`observe` / `confirm` / `auto` | `confirm` |
| `VOLE_WORKSPACE_ROOT` | 工作目录 | `.` |
| `VOLE_LONG_TERM_MEMORY` | 记忆策略：`disabled` / `read-only` / `write` | `disabled` |
| `VOLE_PROMPT_MODE` | 提示词渲染：`full` / `minimal` / `none` | `full` |
| `VOLE_EXECUTION_CONTRACT` | 执行纪律：`default` / `strict-agentic` | `default` |
| `VOLE_TOOL_PROFILE` | 工具能力集：`coding` / `full` / `messaging` / `background` | `full` |
| `VOLE_SANDBOX` | 将 Shell 限制在工作区根目录：`true` / `false` | `false` |
| `VOLE_THINKING_BUDGET` | Anthropic 推理深度：`off` / `minimal` … `max` / `adaptive` | `adaptive` |

**文件配置**（推荐已安装用户使用）：

```json
// ~/.vole/config.json  — 用户级，适用于所有项目
{ "apiKey": "sk-ant-...", "model": "claude-haiku-4-5" }

// vole.config.json  — 项目级，可提交到代码仓库
{ "defaultMode": "auto", "sandbox": true }
```

配置文件自动加载，环境变量优先级高于文件配置。

---

## 开发

### 本地启动

```bash
pnpm install          # 安装所有依赖
cp .env.example .env  # 填入 API Key（或使用 ~/.vole/config.json）
pnpm chat             # 交互式聊天 — 与安装后的 vole chat 一致
pnpm web              # Web UI 开发服务器 — 与安装后的 vole web 一致
                      #   Hono API：http://localhost:3120
                      #   Vite 开发：http://localhost:5173（热重载）
```

workspace 根目录默认为当前目录 — 像使用已安装的 `vole chat` 一样，在项目目录下运行 `pnpm chat` 即可。

### 测试与检查

```bash
pnpm run check        # 类型检查 + vitest + 双语文档一致性（提交前必跑）
pnpm run typecheck    # 仅 TypeScript
pnpm run test         # 仅 vitest
pnpm run test:watch   # vitest 监听模式
pnpm run docs:check   # 双语标题数量一致性（EN ↔ zh-CN）
pnpm run check:bundle # 构建 + 对打包产物进行冒烟测试（发布前运行）
```

### 生产构建

```bash
pnpm run build
node apps/cli/dist/index.js chat
pnpm --filter @vole/web run start
```

### 贡献

**添加工具**：在 `packages/tools/src/index.ts` 中实现 `ExecutableTool` 工厂函数，在 `ToolExecutionResult` 联合类型中添加结果类型，在对应适配器中注册，并添加测试。

**添加 Provider**：在 `packages/models/src/index.ts` 中实现 `ModelProvider`（或 `StreamingModelProvider`），在 `packages/config/src/index.ts` 中添加配置接入，并用可注入的 Fake 客户端添加测试。

---

## 文档

| 文档 | 说明 |
|---|---|
| [学习指南](./docs/learning/guide.zh-CN.md) | 分阶段课程表，用于系统学习代码库 |
| [路线图](./docs/roadmap/overview.zh-CN.md) | 阶段计划、完成状态 |
| [架构文档](./docs/architecture/) | 每个架构关注点一篇文档 |
| [决策记录](./docs/decisions/) | 关键设计选择的 ADR |
| [研究资料](./docs/research/) | OpenClaw 实现笔记 |

所有文档均有英文和简体中文两个版本。

---

## License

MIT

# ArvinClaw 设计草案

状态：草案
日期：2026-05-02

English version: [2026-05-02-arvinclaw-design.md](./2026-05-02-arvinclaw-design.md)

## 1. 项目意图

ArvinClaw 旨在成为一个真实可用的个人通用 Agent 产品，同时也作为一个学习项目，用来理解 OpenClaw 这类系统背后的架构和实现原理。

这个项目不应该是一个玩具 Demo。每个阶段都应该产出某种可使用的结果，并且每个重要模块都应该包含文档，解释它在通用 Agent 系统中的角色。

## 2. 产品目标

ArvinClaw 最终应该支持多个用户入口：

- CLI
- Web UI
- 桌面应用
- 消息平台
- 后台自动化

第一阶段实现将聚焦 CLI。这能让初始产品足够小，便于构建和检查，同时保持架构开放，未来可以接入其他 adapter。

## 3. 学习目标

项目应该在构建过程中解释 Agent 架构。每个核心模块都应该有对应文档，描述：

- 为什么这个模块存在
- 它拥有什么职责
- 它有哪些输入和输出
- 它依赖什么
- 它如何与其他模块协作
- 未来哪些实现可以替换它

预期文档领域包括：

- Agent loop
- Planner
- Tool registry
- Permission system
- Skill system
- Model provider abstraction
- Session storage
- Memory
- Runtime and execution tracing

Session storage 详细架构说明：[docs/architecture/session-storage.zh-CN.md](../../architecture/session-storage.zh-CN.md)

MVP 记忆边界：

- MVP 通过 session storage 包含 session memory。
- MVP 不包含完整 long-term memory。
- Long-term memory 会延后，直到 session storage、trace、permission 和用户控制边界清楚。

## 3.1 测试目标

每个模块和每次迭代都必须包含与其风险和职责相匹配的测试保障。

测试应被视为架构的一部分，而不是事后补充。每个 phase 都应该定义：

- 针对独立模块行为的单元测试
- 针对跨模块契约的集成测试
- 适用时，针对用户可见工作流的 CLI 或 adapter-level 测试
- 针对权限、工具执行、模型输出解析和 trace 行为的回归测试
- 在可行时，可以验证的文档示例

预期测试深度应随风险变化。权限检查、文件写入、shell 执行、配置加载、模型/工具调用解析，需要比简单格式化代码更强的测试覆盖。

## 4. 已确认的 MVP 方向

MVP 将是一个 TypeScript / Node.js CLI Agent。

已确认选择：

- 主语言：TypeScript
- 运行环境：Node.js
- 仓库结构：轻量 monorepo
- 第一入口：CLI
- 后续入口：Web UI、桌面应用、消息平台 adapter
- 模型设计：`ModelProvider` 抽象
- MVP provider：OpenAI-compatible API
- 工具范围：文件系统、shell、Web 搜索和网页读取
- Skill 范围：基于本地 `SKILL.md` 的轻量 Skill 系统
- 自主模式：`observe`、`confirm`、`auto`
- MVP 默认模式：倾向于 `confirm`，同时提供 `observe` 用于学习和调试

Agent Core 不能依赖 CLI。CLI 应该是共享核心之上的一个 adapter。

## 4.1 仓库结构

ArvinClaw 应该从一开始就使用轻量 monorepo。

详细架构说明：[docs/architecture/project-structure.zh-CN.md](../../architecture/project-structure.zh-CN.md)

目标是在不太早引入沉重发布或发布管理机制的前提下，让核心 Agent 能力与用户入口保持分离。

建议结构：

```text
apps/
  cli/
packages/
  core/
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

职责：

- `apps/cli`：CLI 入口和终端交互
- `packages/core`：Agent loop、任务编排、共享领域类型
- `packages/models`：模型 provider 接口和 provider 实现
- `packages/tools`：工具 registry 和内置工具
- `packages/skills`：本地 Skill 发现和 prompt 集成
- `packages/permissions`：风险分类和批准策略
- `packages/sessions`：会话和 trace 持久化
- `docs`：设计、roadmap 和架构学习文档
- `skills`：项目本地 Skills

MVP 阶段 monorepo 应保持轻量。不应该一开始就引入复杂包发布、release 自动化或不必要的基础设施。

## 5. 自主模式

ArvinClaw 应该支持多种执行模式，因为产品使用和学习使用需要不同层级的可见性和打断频率。

| 模式 | 主要用途 | 行为 |
| --- | --- | --- |
| `observe` | 学习和调试 | 展示每一步、计划、工具选择、输入/输出摘要，并在执行前等待确认。 |
| `confirm` | 默认日常使用 | 低风险动作可以自动执行。高风险动作需要用户确认。 |
| `auto` | 可信自动化 | 在允许的权限策略内连续运行，遇到危险动作、失败或缺少权限时停止。 |

系统应暴露可解释执行轨迹，而不是模型隐藏的 chain of thought。轨迹应该解释 Agent 正在做什么、为什么选择某个工具、返回了什么结果、下一步计划做什么。

## 6. MVP 工具范围

MVP 工具：

详细架构说明：[docs/architecture/tool-system.zh-CN.md](../../architecture/tool-system.zh-CN.md)

- 文件系统读取
- 目录列表
- 文件写入
- Shell 命令执行
- Web 搜索
- 网页读取

初始权限策略：

- 文件读取和目录查看在配置的 workspace 内可以自动执行。
- 文件写入需要确认。
- Shell 执行需要确认。
- Web 搜索和网页读取可以自动执行，但应该记录来源和结果摘要。

## 6.1 权限模型

MVP 应使用基于风险的权限模型。

详细架构说明：[docs/architecture/permission-system.zh-CN.md](../../architecture/permission-system.zh-CN.md)

| 风险 | 示例 | 默认行为 |
| --- | --- | --- |
| Low | 列目录、读取 workspace 内文件、读取公开网页 | 自动允许 |
| Medium | 写文件、创建文件、安装依赖、访问 workspace 外路径 | 需要确认 |
| High | 删除文件、执行 shell 命令、修改 git 状态、通过网络提交数据 | 需要带风险说明的明确确认 |
| Blocked | 读取疑似密钥文件、删除大目录、运行已知破坏性命令 | 默认拒绝，除非配置显式允许 |

Shell 执行一开始应作为 High risk，即使命令看起来很简单。后续版本可以为 `pwd`、`ls`、`rg` 等低风险命令增加 allowlist。

自主模式会影响询问用户的频率，但不能绕过权限策略：

- `observe`：可能每一步都要求确认。
- `confirm`：Low risk 动作自动执行，Medium/High 询问确认。
- `auto`：在策略内连续运行，但除非显式配置，仍会在 High 或 Blocked 动作前停止。

延后工具：

- 浏览器自动化
- 长期记忆
- 后台定时任务
- 多 Agent 编排
- 远程节点
- 完整沙箱

## 6.2 Web 工具

Web 能力应拆分为两个抽象：

- `WebSearchProvider`：搜索 Web，并返回带标题、URL、摘要和 metadata 的候选结果。
- `WebPageReader`：读取指定 URL，并返回干净文本、metadata 和来源信息。

Agent Core 应依赖这些抽象，而不是某个具体搜索厂商。

MVP 应支持手动配置的搜索 provider。可能的 provider 包括 Tavily、Brave Search、SerpAPI 或兼容 HTTP provider。具体第一 provider 可在实现计划阶段选择。

网页读取应该是独立于搜索的工具。这样 Agent 可以先搜索，再选择要检查哪些页面。

Web 工具结果应在执行轨迹中摘要，并保留来源 URL 供用户复查。

## 7. Skill 系统

MVP 应包含轻量本地 Skill 系统。

详细架构说明：[docs/architecture/skill-system.zh-CN.md](../../architecture/skill-system.zh-CN.md)

一个 Skill 是至少包含 `SKILL.md` 的目录。该文件应声明：

- Skill 名称
- 用途
- 何时使用
- 推荐步骤
- 安全注意事项

MVP Skill 系统只加载本地 Skills。暂不包含 marketplace、远程安装、版本管理或信任系统。

建议 Skill 优先级：

1. 项目 Skills：`<workspace>/skills`
2. 用户 Skills：`~/.arvinclaw/skills`
3. 内置 Skills

Skills 主要影响 Agent 行为和指令。真实动作仍必须通过 tools 和 permission system。

初始内置 Skills：

- `research`：指导 Web 搜索、来源读取、来源比较和带引用意识的总结。
- `project-inspector`：指导项目结构检查、技术栈识别和模块总结。
- `task-planner`：指导将用户目标拆解为可执行步骤。
- `docs-writer`：指导编写模块说明和面向学习的文档。
- `safe-shell`：可选内置 Skill，指导 shell 命令风险评估和命令目的说明。

## 8. 模型层

Agent Core 应依赖 `ModelProvider` 接口，而不是某个具体厂商 SDK。

详细架构说明：[docs/architecture/model-provider.zh-CN.md](../../architecture/model-provider.zh-CN.md)

MVP 只实现 OpenAI-compatible provider。

预期配置：

- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `maxTokens`

未来 provider 可以包括：

- Anthropic
- Gemini
- Ollama
- 本地 OpenAI-compatible runtime

## 8.1 配置和密钥

MVP 应使用配置文件保存非敏感设置，并使用环境变量保存密钥。

配置层：

- 项目配置：当前 workspace 中的 `arvinclaw.config.json`
- 用户配置：`~/.arvinclaw/config.json`
- 用于密钥和覆盖项的环境变量

非敏感配置示例：

- 模型 provider 类型
- `baseURL`
- `model`
- `temperature`
- `maxTokens`
- 默认自主模式
- Workspace root
- 启用的 tools
- Permission policy 默认值

密钥不应写入项目配置文件。API keys 应通过环境变量提供，例如 `ARVINCLAW_API_KEY`。

CLI `/config` 命令应展示当前生效配置，同时隐藏密钥值。

未来版本可以支持加密本地 secret storage 或 OS keychain 集成。

## 9. Agent Loop 方向

首选方向是混合 loop：

详细架构说明：[docs/architecture/agent-loop.zh-CN.md](../../architecture/agent-loop.zh-CN.md)

- 简单任务可以使用直接工具调用 loop。
- 复杂任务可以包含轻量规划阶段。
- 架构应为后续更强的 Planner 预留空间。

Loop 应支持：

- 目标输入
- 可选规划
- 工具选择
- 权限检查
- 工具执行
- Observation
- 计划更新或最终响应
- 执行轨迹持久化

## 9.1 执行轨迹

MVP 默认应使用可解释执行轨迹。

详细架构说明：[docs/architecture/execution-trace.zh-CN.md](../../architecture/execution-trace.zh-CN.md)

默认 trace 应展示：

- Agent 如何理解用户目标
- Agent 是否创建或更新了计划
- Agent 选择了哪个工具
- 为什么选择该工具
- 做出了什么权限决策
- 工具输入和输出的安全摘要
- Agent 下一步会做什么
- 最终结果

Trace 不应暴露隐藏模型推理。它应该是对执行过程的产品级解释。

Trace levels：

| Level | 用途 | 内容 |
| --- | --- | --- |
| Concise | 快速产品使用 | 工具名称、短结果、最终答案 |
| Explainable | MVP 默认模式 | 目标理解、计划、工具选择原因、权限决策、输入/输出摘要、下一步 |
| Debug | 开发 | 原始 provider messages、原始工具参数、耗时、可用时的 token usage |

CLI 应默认使用 explainable trace。后续 debug option 可以暴露开发级细节。

## 10. CLI 方向

CLI 最终应同时支持：

- 交互式 chat 模式，例如 `arvinclaw chat`
- 单次任务模式，例如 `arvinclaw run "<goal>"`

已确认 MVP 方向：

- `chat` 是第一优先工作流。
- `run` 应保留在命令结构中，初期可以复用一次性 chat 执行路径。
- 第一版不应包含复杂 `run` 参数、批处理、后台执行或任务队列。

建议第一批 CLI 命令：

- `/mode observe|confirm|auto`
- `/tools`
- `/skills`
- `/trace`
- `/config`
- `/help`
- `/exit`

CLI 应让执行轨迹足够可见，便于学习，但不暴露隐藏模型推理。

## 11. Roadmap

Roadmap 应将 ArvinClaw 从小而可用的 CLI MVP 演进成完整个人 Agent 平台。

详细 roadmap：[docs/roadmap/overview.zh-CN.md](../../roadmap/overview.zh-CN.md)

| Phase | 目标 | 结果 |
| --- | --- | --- |
| Phase 0 | 项目骨架与文档体系 | TypeScript 项目结构、CLI shell、配置系统、初始设计文档 |
| Phase 1 | MVP agent loop | CLI chat、OpenAI-compatible model provider、基础工具 loop、执行轨迹 |
| Phase 2 | 工具与权限 | 文件、shell、web 工具；风险等级与确认策略 |
| Phase 3 | 轻量 skills | 本地 `SKILL.md` 加载、内置 skills、skill 选择、skill 文档 |
| Phase 4 | 规划与自主模式 | Planner、任务状态、`observe` / `confirm` / `auto`、失败恢复 |
| Phase 5 | 会话、记忆与知识 | Session storage、任务历史、长期记忆、本地知识检索 |
| Phase 6 | Web UI | Chat UI、任务轨迹、工具调用日志、权限确认面板 |
| Phase 7 | 多入口 adapters | CLI、Web、桌面和消息 adapters 共享同一个 Agent Core |
| Phase 8 | 后台自动化 | Scheduler、daemon mode、event triggers、task queue |
| Phase 9 | Plugin 和 skill 生态 | Skill 安装、启用/禁用、权限声明、版本管理 |
| Phase 10 | 完整 OpenClaw-like 平台 | 多模型、多 Agent、多节点、沙箱化工具、成熟产品体验 |

每个 phase 应包括：

- 用户可见结果
- 新增架构模块
- 要新增或更新的学习文档
- 验收标准
- 明确非目标

## 12. 下一步设计工作

当前没有主要 MVP 方向问题仍处于开放状态。下一步是把已接受设计拆分为聚焦的 roadmap 和 architecture 文档，然后检查完整设计是否存在歧义、矛盾或范围漂移。

## 13. 文档计划

建议文档结构：

```text
docs/
  superpowers/
    specs/
      2026-05-02-arvinclaw-design.md
  architecture/
    agent-loop.md
    model-provider.md
    tool-system.md
    permission-system.md
    skill-system.md
    session-storage.md
    execution-trace.md
  roadmap/
    phase-0.md
    phase-1.md
```

这份草案应随着设计讨论继续更新。设计批准后，应检查占位符、矛盾、歧义和范围膨胀，然后再进入实现计划。

随着设计增长，主文档应保持为简洁的产品和架构总览。详细内容应拆分到聚焦文档中，并从这里引用。预期拆分点：

- Roadmap 细节：`docs/roadmap/`
- 架构模块说明：`docs/architecture/`
- Phase 实现计划：未来放在 `docs/superpowers/plans/` 下的计划文档
- 产品决策和权衡：当内容过于详细时，从本设计文档链接出去

文档语言策略：

- 每份重要项目文档都应同时有英文和简体中文版本。
- 英文文件使用普通 `.md` 后缀。
- 简体中文文件使用 `.zh-CN.md`。
- 两个版本必须是同一内容的完整翻译。
- 标题、章节、示例、图表、表格和验收标准必须保持结构对齐，除非明确标注为特定语言说明。
- 更新文档时，必须在同一轮设计中同步更新对应语言版本。

## 13.1 Commit 策略

项目提交应该小、可读，并且易于回滚。

Commit 期望：

- 按主题提交相关改动。
- 避免混合无关的设计、实现、测试和格式化改动。
- 优先多个聚焦提交，而不是一个大型 catch-all commit。
- Commit message 应解释改动目的。
- 文档更新应和匹配的双语版本一起提交。
- 在可行时，测试应和它保护的行为一起提交。
- 大型 roadmap 或架构变化应按模块或 phase 拆分。

这个策略存在的原因是让未来读者能够理解项目如何演进，并且让有风险的改动可以在不丢失无关工作的情况下回滚。

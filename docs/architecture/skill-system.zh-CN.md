# Skill System

状态：活跃
日期：2026-05-11

English version: [skill-system.md](./skill-system.md)

## 1. 目的

Skill System 给 Vole 提供一种通过可复用指令扩展 Agent 行为的方式。

一个 skill 教会 Agent 如何处理某一类任务，例如 research、project inspection、task planning、documentation writing 或 safe shell usage。

核心规则：

Skills 指导行为。Tools 执行动作。Permissions 决定动作是否允许。

## 2. 为什么这个模块存在

没有 skills，每个工作流都必须塞进 core prompt，或硬编码进 Agent Core。这会让系统更难检查、更难自定义，也更难演进。

Skill System 给 Vole 提供：

- 可复用工作流指令
- 项目级行为覆盖
- 用户级偏好
- 不从完整 plugin marketplace 起步的 plugin 演进路径
- 一种便于学习的方式，用来检查 Agent 行为是如何被塑造的

## 3. MVP 范围

MVP 应实现轻量本地 Skill System。

MVP 包含：

- 从本地目录加载 skills
- 解析 `SKILL.md`
- 应用优先级规则
- 在 CLI 中列出已加载 skills
- 将相关 skill instructions 加入模型上下文
- 提供一小组内置 skills

MVP 不包含：

- 远程 skill 安装
- Skill marketplace
- Skill version manager
- Skill trust review UI
- Skill files 任意授予权限
- Skill-provided executable code

## 4. Skill 目录形态

每个 skill 是一个至少包含以下文件的目录：

```text
SKILL.md
```

未来 skills 可以包含支持文件：

```text
research/
  SKILL.md
  examples.md
  templates/
```

MVP 可以从只读取 `SKILL.md` 开始。等加载和选择模型清楚后，再添加支持文件。

## 5. `SKILL.md` 内容

经过 OpenClaw 源码研究（2026-05-04）确认，标准格式只有两个必须的 frontmatter 字段：

- `name`：skill 标识符，用于加载、覆盖和 CLI 展示。
- `description`：同时用作目的说明和路由触发器。模型读取这个字段来判断该 skill 是否适用于当前任务。不要单独增加 `when` 字段，请把"何时使用"的意图合并到 `description` 中。

文件正文包含完整的工作流指令，仅在 skill 触发时加载。正文目标不超过 5000 词。

示例：

```markdown
---
name: research
description: 用于调查外部信息、比较来源或总结发现时使用。指导 Web 搜索、来源阅读、来源比较和带引用意识的输出。
---

# Research

使用此 skill 搜索、阅读来源、比较证据，并整理含来源链接的发现总结。

[此处为完整工作流指令…]
```

Skills 可以包含附属资源目录（`scripts/`、`references/`、`assets/`），由 Agent 按需加载。这些不是标准的必要部分，在基础加载模型稳定前不应添加。

### 渐进式加载（Progressive Disclosure）

Skill system 使用三级上下文加载：

1. **Skill index** — 仅包含 `name` + `description`（每条约 100 词）。每次模型调用都包含在上下文中。
2. **SKILL.md 正文** — 完整工作流指令。仅在 skill 触发时加载。
3. **附属资源** — 脚本、参考资料或模板。由 Agent 在执行过程中按需加载。

这样每次调用的 skill index 保持紧凑，完整指令仍可按需获取。

## 6. Skill 加载位置

Skills 应从三个位置加载。

优先级顺序：

1. Project skills：`<workspace>/skills/*/SKILL.md`
2. User skills：`~/.vole/skills/*/SKILL.md`
3. Built-in skills

如果多个 skills 同名，更高优先级的 skill 胜出。

这允许项目在有更具体需求时覆盖用户或内置 skill。

## 7. 内置 Skills

MVP 应包含这些内置 skills：

- `research`：指导 Web 搜索、来源读取、来源比较和带引用意识的总结。
- `project-inspector`：指导项目结构检查、技术栈识别和模块总结。
- `task-planner`：指导将用户目标拆解为可执行步骤。
- `docs-writer`：指导编写模块说明和面向学习的文档。
- `safe-shell`：可选内置 skill，指导 shell 命令风险评估和命令目的说明。

这些 skills 应证明系统有用，而不要求用户马上创建自己的 skills。

## 8. Skill 选择

MVP skill 选择可以从简单模型开始。

可能的选择输入：

- 用户消息
- 未来的显式 CLI 命令
- Skill descriptions
- 当前 task type
- Tool request context

初始行为可以是：

- 加载所有 skills。
- 在上下文中包含紧凑 skill index。
- 让模型选择相关 skills。
- 将选中的 skill instructions 加入 working context。

后续版本可以增加确定性匹配、显式用户选择，或单独的 skill-selection model step。

## 9. Prompt 集成

Skills 应以受控方式加入模型上下文。

上下文应包含紧凑的 skill index — 仅包含 skill name 和 description。完整 skill 正文指令按需加载，仅在模型选择该 skill 时才加载。这遵循第 5 节描述的渐进式加载原则。

系统应避免把每个完整 skill 正文都塞进每次模型调用。过大或无关的 skill 文本会浪费上下文，也可能让行为混乱。

## 10. Skill 边界

Skills 不能绕过核心安全系统。

Skill 可以：

- 建议工作流
- 告诉 Agent 何时使用某些 tools
- 解释如何评估结果
- 定义输出期望
- 添加安全提醒

Skill 不能：

- 直接执行代码
- 给自己授予 tool permissions
- 覆盖 blocked actions
- 绕过正常 tool system 读取文件
- 直接改变 model provider 配置
- 持久化 secrets

## 11. 与 Tools 的关系

Skills 和 tools 不同。

| 概念 | 角色 |
| --- | --- |
| Skill | 教 Agent 如何处理任务 |
| Tool | 执行外部动作 |
| Permission | 决定动作能否运行 |

示例：

- `research` skill 告诉 Agent 比较来源。
- `web_search` tool 查找候选页面。
- `read_web_page` tool 读取选定页面。
- Permission policy 决定这些 Web 动作是否可以运行。

## 12. 与 Plugins 的关系

MVP Skill System 不是完整 Plugin System。

Skills 是走向可扩展性的第一步，因为它们易于检查且风险较低。后续 plugin phases 可以增加：

- Installable packages
- Version metadata
- Permission declarations
- Tool contributions
- Trust review
- Enable/disable controls

MVP 应保持 skills 只是 instructions。

## 13. CLI 行为

CLI 最终应支持：

- `/skills`：列出已加载 skills
- `/skills <name>`：展示 skill 摘要
- 未来显式 skill activation

MVP 可以从只支持 `/skills` 开始。

CLI 应展示：

- Skill name
- Source location
- Description
- 是否覆盖了另一个 skill

## 14. Skill 错误

Skill 加载应优雅处理错误：

- 缺少 `SKILL.md`
- Invalid frontmatter
- Duplicate skill names
- Unreadable skill directory
- Empty skill description

错误应在 debug 或 startup output 中可见，但坏掉的 optional skill 不应阻止整个 Agent 启动，除非配置要求它必须存在。

## 15. 测试要求

Skill System 需要测试，因为它塑造 Agent 行为，并支撑未来扩展性。

必需测试领域：

- 从 project、user 和 built-in locations 发现 skill
- Duplicate names 的优先级规则
- `SKILL.md` 解析
- Invalid skill handling
- CLI skill listing
- 选中 skills 的 prompt integration
- 确保 skills 不能授予权限或绕过 blocked actions
- 新增 skill metadata fields 时的回归测试

任何改变 loading locations、precedence rules、prompt assembly 或 built-in skills 的迭代，都应更新 skill tests。

## 16. 验收标准

MVP Skill System 成功标准：

- Skills 从 project、user 和 built-in locations 加载。
- 同名情况下，project skills 覆盖 user 和 built-in skills。
- Built-in MVP skills 可用。
- CLI 可以列出已加载 skills。
- Skill instructions 可以影响 model context。
- Skills 不能直接执行动作或绕过 permissions。
- Skill loading errors 被清晰报告。
- Skill behavior 被 unit 和 integration tests 覆盖。

## 17. 相关文档

- [主设计](../product/vole-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)

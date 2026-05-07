# Vole Agent — 模块学习计划

**从这里开始：** [学习指南](./guide.zh-CN.md) — 阶段式学习课程。
**模块模板：** [_template.zh-CN.md](./_template.zh-CN.md) — 每个模块文档的标准格式。

对 Vole TypeScript monorepo 每个模块的系统性深度学习。
每次学习一个模块：一起阅读源码、讨论设计决策、将实现与 OpenClaw 模式对照，
最后将结论总结成该模块的专属文档。

---

## 每次学习的流程

1. **读公开接口** — 导出类型揭示了模块的承诺
2. **读测试** — 测试是最诚实的使用文档
3. **走实现主路径** — 跟着核心逻辑流程走
4. **与 OpenClaw 对照** — 这个模块对应参考架构中的哪个部分？
5. **总结** — 产出 `docs/learning/NN-<module>.md` + 中文版

---

## 学习路径

按依赖顺序排列：每个模块只使用它之上的模块中的概念。

| # | 模块 | 源码行数 | 核心概念 | 文档 |
|---|------|---------|---------|------|
| 01 | `@vole/config` | 377 | 环境变量加载、配置结构、脱敏 | ⬜ |
| 02 | `@vole/models` | 871 | Provider 抽象、流式输出、token 计数 | ⬜ |
| 03 | `@vole/permissions` | 82 | allow / ask / deny / block 决策树 | ⬜ |
| 04 | `@vole/tools` | 1182 | 工具注册、执行、工作区沙箱 | ⬜ |
| 05 | `@vole/sessions` | 436 | 消息持久化、互斥锁、历史压缩 | ⬜ |
| 06 | `@vole/taskflow` | 103 | 单次 turn 内任务追踪、todo 状态机 | ⬜ |
| 07 | `@vole/context` | 272 | Prompt 组装、XML 分节、缓存提示 | ⬜ |
| 08 | `@vole/skills` | 384 | Skill 发现、惰性加载、frontmatter 路由 | ⬜ |
| 09 | `@vole/scheduler` | 207 | Cron 后台运行、触发器生命周期 | ⬜ |
| 10 | `@vole/adapters` | 123 | 工具 profile（coding / full / messaging） | ⬜ |
| 11 | `@vole/core` | 855 | **Agent 循环** — 整个系统的核心 | ⬜ |
| 12 | `@vole/gateway` | 49 | 会话生命周期、并发运行守卫 | ⬜ |
| 13 | `apps/cli` | 1597+514 | CLI 适配器、Ink 渲染、slash 命令 | ⬜ |
| 14 | `apps/web` | — | Web 适配器、SSE 流式、REST API | ⬜ |

---

## 模块职责一览

| 模块 | 做什么 |
|------|--------|
| `config` | 读取环境变量 → 经过校验和类型化的、可安全脱敏的配置对象 |
| `models` | 将 Anthropic / OpenAI / OpenRouter 包装成统一的 `ModelProvider` 接口 |
| `permissions` | 将（工具, 路径）映射到 allow / ask / deny / block；不含业务逻辑 |
| `tools` | Shell、文件读写、搜索、编辑 — agent 的"双手" |
| `sessions` | 将对话历史序列化到磁盘；每个会话一把互斥锁 |
| `taskflow` | 追踪单次 turn 内的 `TodoItem[]`；update_todos 工具写入此处 |
| `context` | 组装模型实际接收到的 system prompt + message 数组 |
| `skills` | 按需加载 `.md` skill 文件；构建 `<skills>` 索引 |
| `scheduler` | 持久化 cron 触发器；触发后台 `AgentRuntime` 运行 |
| `adapters` | 根据 VOLE_TOOL_PROFILE 决定实例化哪些工具 |
| `core` | 17 事件异步生成器循环：plan → tool call → observe → 重复 |
| `gateway` | 创建/恢复会话；防止并发运行 |
| `apps/cli` | 终端 UI（Ink）、slash 命令、流式输出、权限提示 |
| `apps/web` | HTTP + SSE 服务端；React 浏览器客户端 |

---

## 贯穿所有模块的主题

- **OpenClaw 对齐** — 这个模块实现了 OpenClaw 的哪个模式？
- **边界纪律** — 这个模块明确不负责什么？
- **事件 / 数据契约** — 什么类型跨越模块边界传递？
- **可测试性方案** — 测试中如何 fake 外部依赖？

---

## 阶段进度

| 阶段 | 主题 | 状态 | 文档 |
|---|---|---|---|
| 阶段一 | Agent Loop 心智模型 | ✅ 已完成 | [01-concepts.zh-CN.md](./01-concepts.zh-CN.md) |
| 阶段二 | 核心循环代码 | ✅ 已完成 | [02-core.zh-CN.md](./02-core.zh-CN.md) |
| 阶段三 | 基础层模块 | ⬜ 未开始 | — |
| 阶段四 | 扩展系统 | ⬜ 未开始 | — |
| 阶段五 | 系统综合 | ⬜ 未开始 | — |

## 模块进度

| # | 模块 | 状态 | 文档 |
|---|------|------|------|
| 01 | config | ✅ 已完成 | [13-config.zh-CN.md](./13-config.zh-CN.md) |
| 02 | models | ✅ 已完成 | [03-models.zh-CN.md](./03-models.zh-CN.md) |
| 03 | permissions | ✅ 已完成 | [04-permissions.zh-CN.md](./04-permissions.zh-CN.md) |
| 04 | tools | ✅ 已完成 | [05-tools.zh-CN.md](./05-tools.zh-CN.md) |
| 05 | sessions | ✅ 已完成 | [07-sessions.zh-CN.md](./07-sessions.zh-CN.md) |
| 06 | taskflow | ✅ 已完成 | [08-taskflow.zh-CN.md](./08-taskflow.zh-CN.md) |
| 07 | context | ✅ 已完成 | [06-context.zh-CN.md](./06-context.zh-CN.md) |
| 08 | skills | ✅ 已完成 | [09-skills.zh-CN.md](./09-skills.zh-CN.md) |
| 09 | scheduler | ✅ 已完成 | [10-scheduler.zh-CN.md](./10-scheduler.zh-CN.md) |
| 10 | adapters | ✅ 已完成 | [11-adapters.zh-CN.md](./11-adapters.zh-CN.md) |
| 11 | core | ✅ 已完成 | [02-core.zh-CN.md](./02-core.zh-CN.md) |
| 12 | gateway | ✅ 已完成 | [12-gateway.zh-CN.md](./12-gateway.zh-CN.md) |
| 13 | apps/cli | ✅ 已完成 | [14-cli.zh-CN.md](./14-cli.zh-CN.md) |
| 14 | apps/web | ⬜ 未开始 | — |

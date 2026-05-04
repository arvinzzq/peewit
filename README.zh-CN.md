# ArvinClaw

English version: [README.md](./README.md)

ArvinClaw 是一个受 OpenClaw 启发的个人通用 Agent 项目。

目标有两个：

- 构建一个真实的 CLI-first Agent，并逐步成长为更完整的个人 Agent 平台。
- 通过从零实现每个模块，学习 OpenClaw-like 系统背后的架构。

## 当前阶段

Phase 4（规划与自主执行）已完成。ArvinClaw 准备继续 Phase 5（会话与记忆）和 Phase 6（Streaming 与 Web UI）。

已完成阶段：

- Phase 0：项目基础 — monorepo、config、文档布局。
- Phase 1：MVP agent loop — CLI chat、ModelProvider、context assembly、execution trace。
- Phase 2：工具与权限 — `read_file`、`list_directory`、guarded `write_file`、guarded `run_shell`、`read_web_page` 工具，含工作区边界检查、secret 文件拦截、破坏性命令 pattern 检测和基于风险的 approval prompts。
- Phase 3：Context assembly 与 skills — 基于 section 的 system prompt（identity、runtime、tooling、safety、skills、workspace）、通过 `ANTHROPIC_API_KEY` 使用 Anthropic provider、含 workspace/user/built-in 优先级的 `SKILL.md` skill loader、内置技能、CLI `/skills` 命令。
- Phase 4：规划与自主执行 — 含 create_plan tool 注入的 `packages/planner` 和 `ModelBasedPlanner`、`AgentRuntime` 中 7 个新 plan events、支持 observe 模式 plan approval 的 `--plan` 逐步规划模式。
- Phase 5（早期基础）：JSONL session storage、workspace prompt 加载和只读 memory 文件策略。

## 文档

从这里开始：

- [Documentation Index](./docs/README.zh-CN.md)
- [Main Design](./docs/product/arvinclaw-design.zh-CN.md)
- [Roadmap](./docs/roadmap/overview.zh-CN.md)
- [Roadmap](./docs/roadmap/overview.zh-CN.md)

## 开发

安装依赖：

```text
pnpm install
```

运行检查：

```text
pnpm run check
```

运行 CLI shell：

```text
pnpm run cli --help
```

# ArvinClaw

English version: [README.md](./README.md)

ArvinClaw 是一个受 OpenClaw 启发的个人通用 Agent 项目。

目标有两个：

- 构建一个真实的 CLI-first Agent，并逐步成长为更完整的个人 Agent 平台。
- 通过从零实现每个模块，学习 OpenClaw-like 系统背后的架构。

## 当前阶段

ArvinClaw 处于 Phase 1：MVP agent loop 阶段。

Phase 0 foundation 已完成。Phase 1 现在正在构建第一版 message-only agent loop。

当前 Phase 1 进展：

- Runtime event contracts 已实现。
- `ModelProvider`、fake provider 和 OpenAI-compatible provider 已实现。
- Minimal context assembly 已实现。
- Message-only `AgentRuntime.runTurn` 已实现。
- CLI chat runtime wiring 仍在进行中。

Phase 1 暂不包含完整 tool execution、long-term memory 或 Web UI。

## 文档

从这里开始：

- [Documentation Index](./docs/README.zh-CN.md)
- [Main Design](./docs/product/arvinclaw-design.zh-CN.md)
- [Roadmap](./docs/roadmap/overview.zh-CN.md)
- [Phase 1 Plan](./docs/plans/phase-1-mvp-agent-loop.zh-CN.md)

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

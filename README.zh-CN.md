# ArvinClaw

English version: [README.md](./README.md)

ArvinClaw 是一个受 OpenClaw 启发的个人通用 Agent 项目。

目标有两个：

- 构建一个真实的 CLI-first Agent，并逐步成长为更完整的个人 Agent 平台。
- 通过从零实现每个模块，学习 OpenClaw-like 系统背后的架构。

## 当前阶段

ArvinClaw 处于 Phase 2：Tools and permissions 阶段。

Phase 0（基础）、Phase 1（MVP agent loop）以及 Phase 5 早期 session 和 memory 基础已完成。

当前 Phase 2 进展：

- Tool registry、permission policy 以及 runtime tool-call 编排已实现。
- `read_file`、`list_directory`、guarded `write_file` 工具已实现，含工作区边界检查和 secret 文件拦截。
- CLI approval prompts 已接入 medium 和 high 风险工具调用。
- Session storage（in-memory 和 JSONL）、workspace prompt 加载以及只读 memory 文件策略作为早期 Phase 5 基础已实现。

Phase 2 剩余工作：shell tool 和 web tools。

## 文档

从这里开始：

- [Documentation Index](./docs/README.zh-CN.md)
- [Main Design](./docs/product/arvinclaw-design.zh-CN.md)
- [Roadmap](./docs/roadmap/overview.zh-CN.md)
- [Phase 2 Plan](./docs/plans/phase-2-tools-and-permissions.zh-CN.md)

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

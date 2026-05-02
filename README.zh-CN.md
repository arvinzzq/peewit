# ArvinClaw

English version: [README.md](./README.md)

ArvinClaw 是一个受 OpenClaw 启发的个人通用 Agent 项目。

目标有两个：

- 构建一个真实的 CLI-first Agent，并逐步成长为更完整的个人 Agent 平台。
- 通过从零实现每个模块，学习 OpenClaw-like 系统背后的架构。

## 当前阶段

ArvinClaw 处于 Phase 0：项目基础阶段。

Phase 0 聚焦：

- TypeScript workspace setup
- Package boundaries
- CLI shell
- Initial configuration layer
- Test 和 documentation checks

它暂时不包含真实 model calls、tool execution、long-term memory 或 Web UI。

## 文档

从这里开始：

- [Documentation Index](./docs/README.zh-CN.md)
- [Main Design](./docs/product/arvinclaw-design.zh-CN.md)
- [Roadmap](./docs/roadmap/overview.zh-CN.md)
- [Phase 0 Plan](./docs/plans/phase-0-foundation.zh-CN.md)

## 开发

安装依赖：

```text
npm install
```

运行检查：

```text
npm run check
```

运行 CLI shell：

```text
npm run cli -- --help
```

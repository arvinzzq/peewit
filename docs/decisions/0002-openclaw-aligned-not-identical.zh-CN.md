# 0002：OpenClaw-Aligned, Not Identical

状态：已接受
日期：2026-05-02

English version: [0002-openclaw-aligned-not-identical.md](./0002-openclaw-aligned-not-identical.md)

## 1. 背景

Peewit 的目标是构建一个 OpenClaw-like 的个人通用 Agent。

OpenClaw 是 primary architecture reference，但 Peewit 也是学习项目，并且是供我们自己使用的产品。这意味着盲目复制每个实现细节不是正确目标。

项目需要明确：我们到底要和 OpenClaw 保持多接近。

## 2. 决策

Peewit 将是：

```text
OpenClaw-inspired, OpenClaw-aligned, Peewit-owned.
```

这意味着：

- 产品目标：OpenClaw-like。
- 架构参考：OpenClaw-first。
- 实现细节：由 Peewit 自主拥有。
- MVP：不追求完整 OpenClaw parity。
- 长期 roadmap：逐步接近 OpenClaw 核心能力 parity。
- Claude Code：secondary engineering-practice reference。

## 3. 必须对齐什么

Peewit 应与 OpenClaw 的核心概念对齐：

- Agent workspace
- Workspace prompt files
- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- Daily memory files
- Skills and plugins
- Tools and permissions
- Context assembly
- Session persistence
- Gateway and multi-entry direction
- Channels
- Background automation
- Multi-agent and multi-node direction

这些概念代表 OpenClaw-like personal agent 的架构形态。

## 4. 什么不需要完全一致

Peewit 不需要复制：

- Function names
- Public concepts 之外的 file names
- Internal module boundaries
- Queue implementation details
- Database choice
- Plugin packaging format
- CLI command names
- UI layout
- Exact default policies
- Exact provider abstractions

如果 OpenClaw 某个成熟实现对 Peewit 当前阶段来说过于复杂，Peewit 应先实现更简单版本。

## 5. 评估规则

决定是否复制某个 OpenClaw behavior 时，问：

1. 这是核心产品能力，还是实现细节？
2. 它是否帮助我们理解通用 Agent 架构？
3. 它是否让系统更安全、更可用或更可扩展？
4. 我们能否在当前 phase 测试它？
5. 我们能否在文档中清楚解释它？

如果答案是否定的，就延后或重新设计。

## 6. 示例

### Memory Files

Peewit 应保留 `SOUL.md`、`USER.md`、`MEMORY.md` 和 daily memory files 这些概念。

Peewit 不需要立即匹配 OpenClaw 的完整 memory engine、hybrid search 或 dreaming behavior。

### Gateway

Peewit 应保留长期 gateway 和 multi-entry 方向。

Peewit 不需要在 MVP 实现 production-grade gateway。

### Skills

Peewit 应保留本地 `SKILL.md` skills，并在后续演进到 plugins。

Peewit 可以从更小的 skill loader 和更简单的 prompt integration 开始。

### Context Engine

Peewit 应把 context assembly 作为一等概念。

Peewit 可以先实现一个简单 deterministic assembler，再引入 plugin-provided context engines。

## 7. 后果

正向影响：

- Peewit 保持与 OpenClaw 的形态对齐。
- MVP 保持可理解、可测试。
- 项目可以做独立设计取舍。
- 文档可以解释为什么某个功能被复制、简化、延后或重新设计。

权衡：

- Peewit 可能与 OpenClaw 实现细节分歧。
- 某些 OpenClaw behaviors 后续可能需要明确 compatibility decisions。
- 我们需要定期研究，避免偏离重要 OpenClaw concepts。

## 8. 相关文档

- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Reference Systems](../architecture/reference-systems.zh-CN.md)
- [主设计](../product/peewit-design.zh-CN.md)

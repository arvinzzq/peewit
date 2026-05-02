# 0001：OpenClaw-Aligned Core Architecture

状态：已接受
日期：2026-05-02

English version: [0001-openclaw-aligned-core-architecture.md](./0001-openclaw-aligned-core-architecture.md)

## 1. 背景

ArvinClaw 最初是一个受 OpenClaw 启发的 TypeScript CLI-first general agent 计划。

经过更深入的 OpenClaw 调研后，项目应该更明确：ArvinClaw 是一个从 0 到 1 的 OpenClaw-like 实现，OpenClaw 是 primary architecture reference。

研究笔记显示，OpenClaw 的核心架构不只是一个带 tools 的 agent loop。它还依赖：

- Session-scoped serialized runs
- Global and per-session queues
- Session write locks
- Dedicated context assembly path
- Workspace bootstrap files
- System prompt sections
- Context engine and compaction
- Memory tools and memory flush behavior
- Streaming event bridges

## 2. 决策

ArvinClaw 将让核心架构与 OpenClaw 文档化的 run shape 对齐：

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

这会从四个方面改变设计重点：

1. Context assembly 成为一等模块。
2. Prompt assembly 不能放在 CLI 内部。
3. Runs 应使用明确 run IDs 建模，并为未来 per-session serialization 做准备。
4. Session persistence 应为 write locks 和 replayable traces 做准备。

## 3. MVP 影响

MVP 仍然保持小。

MVP 应包含：

- CLI chat entry
- Agent Core
- ModelProvider
- Tool System
- Permission System
- Skill index
- Session storage
- Execution trace
- 基础 context assembly package

MVP 暂不包含：

- Full context engine plugins
- Automatic long-term memory writes
- Background heartbeat automation
- Multi-agent routing
- Remote node runtime

## 4. 架构变化

仓库结构应增加 context package：

```text
packages/
  context/
```

职责：

- 构建 model context
- 组装 base system prompt
- 添加 runtime metadata
- 添加 session resume context
- 添加 skill index
- 添加 tool descriptions
- 添加 permission policy guidance
- 后续加载 workspace prompt files
- 后续支持 compaction 和 context engine plugins

## 5. 测试影响

新增必需测试类别：

- Context assembly ordering
- Prompt section inclusion
- Skill index inclusion without full skill body dumping
- Tool description projection
- Permission policy guidance inclusion
- Session resume context bounds
- Future workspace file loading order
- Future compaction summary inclusion

这些测试应在 `packages/context` 实现之前或实现同时引入。

## 6. 后果

正向影响：

- ArvinClaw 更贴近 OpenClaw 的真实架构。
- Prompt assembly 变得可测试。
- 未来 workspace files 和 memory 可以干净加入。
- CLI 保持 adapter 身份，而不是拥有 prompt construction。

权衡：

- MVP 多了一个 package boundary。
- 早期实现需要更多设计纪律。
- 一些功能会感觉更远，因为我们在明确核心边界。

## 7. 相关文档

- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)
- [主设计](../product/arvinclaw-design.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [Session Storage](../architecture/session-storage.zh-CN.md)

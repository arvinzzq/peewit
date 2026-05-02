# Context Engine

状态：草案
日期：2026-05-02

English version: [context-engine.md](./context-engine.md)

## 1. 目的

Context engine 决定 ArvinClaw 如何选择、压缩并投影 context 到一次 model run 中。

Prompt assembly 是第一版 deterministic implementation。Context engine 是更长期的架构，用于支持 compaction、memory retrieval、workspace file projection 和 plugin-provided context。

核心规则：

Prompt assembly 构建请求。Context engine 决定哪些 context 值得进入该请求。

## 2. 为什么这个模块存在

随着 ArvinClaw 成长，model context 会来自许多来源：

- Conversation history
- Tool observations
- Execution trace summaries
- Workspace prompt files
- Skills
- Memory files
- Daily notes
- Local knowledge
- Plugin outputs
- Background task state

没有 context engine，这些来源会以临时方式竞争 model window 空间。

Context engine 给 ArvinClaw 提供：

- Bounded context
- Predictable ordering
- Compaction strategy
- Memory retrieval strategy
- Trace-visible inclusion decisions
- Future plugin extension point

## 3. MVP 范围

MVP 不应实现完整 pluggable context engine。

MVP 应在 `packages/context` 中实现 deterministic context assembler。

MVP 包含：

- Fixed context source ordering
- Session resume context bounds
- Skill index projection
- Tool projection
- Permission guidance projection
- Prompt assembly report
- Redaction before model context

MVP 不包含：

- Context engine plugins
- Semantic memory retrieval
- Automatic compaction
- Background context refresh
- Multi-agent context routing

## 4. 未来 Context Engine 范围

后续 phases 可以扩展 context engine，包含：

- Context source registry
- Context budget allocation
- Context scoring
- Conversation compaction
- Memory retrieval
- Daily note retrieval
- Workspace file projection
- Plugin-provided context
- Provider-specific context shaping

这应该只在 deterministic MVP assembler 经过充分测试之后发生。

## 5. Context Sources

潜在 context sources：

| Source | MVP Status | Notes |
| --- | --- | --- |
| Base system instructions | Included | Always present |
| Runtime metadata | Included | Mode, date, workspace |
| Session messages | Included | Bounded recent turns |
| Tool observations | Included | Summarized |
| Trace summaries | Included | Recent explainable events |
| Skill index | Included | Compact list, not full skill bodies |
| Tool definitions | Included | Provider-neutral projection |
| `AGENTS.md` | Early | Project instructions |
| `SOUL.md` | Later | Read-only identity |
| `USER.md` | Deferred | Needs privacy policy |
| `MEMORY.md` | Deferred | Needs memory write policy |
| Daily notes | Deferred | Needs memory system |
| Plugin context | Deferred | Needs plugin trust model |

## 6. Context Ordering

Context ordering 应是 deterministic 并经过测试。

MVP order：

```text
Base system instructions
  -> Runtime metadata
  -> Effective configuration
  -> Permission guidance
  -> Skill index
  -> Tool definitions
  -> Session resume context
  -> Recent trace summaries
  -> User message
```

OpenClaw-like future order：

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Recent daily notes, if enabled
  -> Session resume context
  -> Selected skills
  -> Tool definitions
  -> User message
```

确切顺序可以演进，但变化必须有意为之并经过测试。

## 7. Context Budget

Context engine 最终应管理 context budget。

Budget decisions 包括：

- 包含多少 recent turns
- 总结多少 tool output
- 是否包含 trace summaries
- 是否包含 memory excerpts
- 哪些 skills 相关
- 是否需要 compaction

MVP 可以使用简单限制，例如 recent turns 和最大字符串长度。

## 8. Compaction

Compaction 将大型 context 转换成更小 summaries。

MVP 不应实现 automatic compaction。

未来 compaction 应支持：

- Conversation summaries
- Tool result summaries
- Trace summaries
- Memory flush before compaction
- User-visible compaction trace events
- Manual compaction commands

Compaction 必须测试，因为它可能丢失或扭曲信息。

## 9. Memory Retrieval

Memory retrieval 应延后，直到 memory policy 准备好。

未来 retrieval 可以包括：

- `MEMORY.md` excerpts
- Daily note excerpts
- Local knowledge search
- Hybrid lexical/vector retrieval
- User-approved memory promotion

Memory retrieval 应在 trace 中可见，并有边界。

## 10. Context Reports

每次 context assembly 都应该能产生 report。

Report fields：

- Sources considered
- Sources included
- Sources omitted
- Omission reason
- Size estimates
- Redactions
- Compaction actions
- Memory retrieval actions

Report 帮助用户和开发者理解为什么模型看到了某些 context。

## 11. 与 Prompt Assembly 的关系

在 MVP 中，prompt assembly 和 context assembly 可以位于同一个 package。

概念上：

- Context engine 选择并塑造 context。
- Prompt assembly 将选中的 context 格式化为 model input。

在设计中保持这种区分，会让未来演进更容易。

## 12. 与 Session Storage 的关系

Session storage 是主要 context source。

Context engine 应通过 session interface 读取有边界的 session data，而不是直接读 raw files。

Session storage 负责 persistence。Context engine 负责 selection。

## 13. 与 Memory System 的关系

Memory system 拥有 durable memory。

Context engine 负责将 memory 检索并投影到 model run 中。

Memory writes 不应该发生在 context engine 内部。它们应通过 tools、permission policy 和 trace。

## 14. 测试要求

Context engine behavior 需要强测试。

必需测试领域：

- Source ordering
- Context size bounds
- Session resume projection
- Skill index projection
- Tool projection
- Permission guidance projection
- Redaction
- Omitted source reporting
- Future workspace file loading
- Future compaction summaries
- Future memory retrieval bounds

任何改变 prompt assembly、session storage、memory、skills、tools、permissions 或 model providers 的迭代，都应更新 context tests。

## 15. 验收标准

MVP context assembly 成功标准：

- Context construction 不由 CLI 拥有。
- Context source order 是 deterministic。
- Session context 有边界。
- Skill index 和 tool definitions 被一致投影。
- Permission guidance 被包含。
- Redaction 在 model context 前发生。
- Context assembly 产生 report。
- Behavior 被 unit tests 覆盖。

## 16. 相关文档

- [Prompt Assembly](./prompt-assembly.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Memory System](./memory-system.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [主设计](../superpowers/specs/2026-05-02-arvinclaw-design.zh-CN.md)

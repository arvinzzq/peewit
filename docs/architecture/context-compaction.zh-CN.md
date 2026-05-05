# Context Compaction

状态：设计
日期：2026-05-05

English version: [context-compaction.md](./context-compaction.md)

## 1. 目的

随着 session 增长，累积的会话消息最终会接近模型的 context window 上限。如果没有 compaction，长时间运行的 agent session 会因 context overflow 错误失败，或静默地丢弃早期消息。

Context compaction 通过总结会话历史的旧部分来解决这个问题，用紧凑摘要替换旧消息，同时保留最近消息的原文。这使得任意长度的 session 成为可能，同时保留最具操作性的近期上下文。

核心规则：

Compaction 是意图上无损的操作 — 摘要必须包含继续任务所需的所有决策、tool 结果和状态。如果 compaction 无法安全进行，则返回原始消息不变。

## 2. 触发条件

当当前消息列表超过配置的 `maxMessages` 阈值时，在每次模型请求前触发 compaction。

阈值有意设置在硬性 context window 限制之前，以便为以下内容留出空间：

- System prompt
- 传入的 tool 结果
- 下一次模型响应

默认值：`maxMessages: 200`。可通过 `CompactionOptions` 调整。

Compaction 不在每个 turn 运行 — 只有在超过阈值时才运行。检查是 O(1)：将 `messages.length` 与 `maxMessages` 比较。

## 3. Compaction 算法

触发后，compaction 算法按以下步骤进行：

1. 将消息分成两组：
   - **旧消息**：从索引 `0` 到 `messages.length - keepRecent - 1` 的消息
   - **近期消息**：最后 `keepRecent` 条消息（原文保留，从不压缩）

2. 使用 `summarySystemPrompt` 加上旧消息作为输入，调用摘要模型。摘要模型可以是同一个模型或更便宜的变体。

3. 如果摘要调用成功，用包含摘要文本的单个合成 assistant 消息替换旧消息。

4. 返回：`[summaryMessage, ...recentMessages]`

如果旧消息块为空（即 `messages.length <= keepRecent`），跳过 compaction 并返回消息不变。

## 4. CompactionOptions 接口

```typescript
interface CompactionOptions {
  /** 消息数量超过此值时触发 compaction。默认：200 */
  maxMessages: number;

  /** 原文保留的近期消息数量。默认：20 */
  keepRecent: number;

  /** 生成摘要时注入的 system prompt。 */
  summarySystemPrompt: string;
}
```

`summarySystemPrompt` 应指导模型生成简洁的事实性摘要，涵盖：

- 原始任务或目标
- 已做的关键决策
- Tool 调用及其结果
- 当前状态和未解决问题
- 仍处于活动状态的约束或指令

## 5. 与 AgentRuntime 的集成

`AgentRuntime` 在 `buildModelRequest()` 开始时、组装最终上下文之前调用 `compactIfNeeded(messages, options)`。

流程：

```
runTurn()
  -> buildModelRequest()
       -> compactIfNeeded(messages, options)   // <- compaction hook
       -> assembleContext(compactedMessages)
       -> model.complete(request)
```

Compaction 对循环的其余部分透明。Tool executor、permission system 和 trace system 感知不到任何差异。

成功 compaction 后会发出 `context_compacted` trace 事件，记录：

- 原始消息数量
- Compaction 后的消息数量
- 摘要字符长度
- 是否遵守了 keepRecent

## 6. 故障保护

如果摘要模型调用因任何原因失败（网络错误、模型拒绝、超时），compaction 函数会捕获错误，记录警告 trace 事件，并返回**原始消息不变**。

Agent turn 会继续使用完整的未压缩消息列表。这比使 turn 失败或静默截断消息更安全。

故障保护规则：

Compaction 失败绝不能导致 agent turn 失败。降级的上下文总比没有响应好。

## 7. OpenClaw 对齐

OpenClaw 将 context compaction 作为其 `context-engine-maintenance` 子系统的一部分实现。关键对齐：

| OpenClaw 概念 | ArvinClaw 等效 |
| --- | --- |
| `context-engine-maintenance` | `AgentRuntime` 中的 `compactIfNeeded()` |
| 硬性限制阈值 | `CompactionOptions` 中的 `maxMessages` |
| 摘要注入 | 合成 assistant 消息前置于近期消息 |
| 故障保护直通 | 错误捕获 + 返回原始消息 |

OpenClaw 的 compaction 还为每个 session 追踪 `compactionCount` 以提高可观察性。ArvinClaw 应通过 trace 事件实现相同功能。

## 8. 验收标准

Context compaction 在满足以下条件时视为完成：

- `compactIfNeeded()` 仅在 `messages.length > maxMessages` 时触发。
- 近期消息（`keepRecent`）始终原文保留。
- Compaction 后，摘要作为合成消息插入位置 0。
- 成功时发出 `context_compacted` trace 事件。
- 如果摘要模型调用失败，返回原始消息不变。
- Compaction 集成到 `AgentRuntime.buildModelRequest()` 中，不改变 tool 或 permission pipeline。
- 单元测试覆盖：触发条件、摘要注入、故障保护、keepRecent 边界。

## 9. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [Context Engine](./context-engine.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Skill System](./skill-system.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

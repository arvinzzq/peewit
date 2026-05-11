# Session Storage

状态：活跃
日期：2026-05-11

English version: [session-storage.md](./session-storage.md)

> **Phase 14 更新**：新增 `SqliteSessionStore` 作为 `SessionStore` 接口的姐妹实现，与现有 `JsonlSessionStore` 并列。通过配置 `storage.backend: "sqlite" | "jsonl"` 选择（迁移 commit 后默认改为 `"sqlite"`）。两个 store 实现同一契约，消费者无需按 backend 分支。`vole migrate jsonl-to-sqlite` 命令做一次性原子转换，含行数校验与备份；Phase 11 Step 4 的跨进程文件锁继续保护并发写。见 [Phase 14 计划](../plans/phase-14-sqlite-storage-unification.zh-CN.md)。

## 1. 目的

Session storage 持久化 Vole 的对话和执行历史。

MVP 需要 session storage，这样用户可以继续 CLI 对话、检查最近 trace events，并理解之前 turns 中发生了什么。

核心规则：

MVP 包含 session memory，但不包含完整 long-term memory system。

## 2. Session Memory vs Long-Term Memory

Vole 应区分 session memory 和 long-term memory。

| 概念 | MVP 状态 | 含义 |
| --- | --- | --- |
| Session memory | 包含 | 一个 session 的 conversation history、user turns、assistant responses、tool observations、trace events |
| Long-term memory | 延后 | 跨 session 用户偏好、持久知识、semantic retrieval、vector indexes、knowledge graph |

Session memory 是 MVP 必需的，因为 Agent 需要在一个对话内部有连续性。

Long-term memory 延后到后续阶段，因为它引入更多设计问题：

- 应该记住什么？
- 谁批准 memory writes？
- Memory 如何编辑或删除？
- 私人事实如何保护？
- Retrieval 如何避免陈旧或错误上下文？

## 3. 为什么这个模块存在

没有 session storage，每次 CLI 运行都是无状态的。这会降低产品可用性，也削弱学习目标，因为用户无法检查一个任务是如何展开的。

Session storage 给 Vole 提供：

- 对话连续性
- Trace inspection
- Task history
- 调试支持
- 未来 Web UI session views 的基础
- 通向未来 memory systems 的路径

## 4. MVP 范围

MVP session storage 应支持：

- 创建 session
- 追加 user messages
- 追加 assistant messages（含 `toolCalls` 字段，用于携带工具调用数据的消息）
- 追加 tool result messages（含 `toolCallId` 字段，链接到触发该结果的工具调用）
- 追加 trace events
- 追加 `compact_boundary` 记录，持久化 compaction 结果
- 列出最近 sessions
- 加载 session
- 通过 CLI 展示最近 trace details

适配器持久化每轮对话的所有消息——不只是最终的 user+assistant 对。工具调用上下文（带 `toolCalls` 的 assistant 消息、带 `toolCallId` 的 tool result 消息）被保留，以便 session 恢复时能重建完整上下文。

MVP 不需要：

- Semantic search
- Vector storage
- Cross-session memory extraction
- Cloud sync
- Multi-user accounts
- Shared team workspaces

## 5. Storage Backend

MVP 使用简单本地 file-based backend。

默认位置：

```text
~/.vole/sessions/
```

**Project-local session storage 已实现。** CLI 在启动时检测 git 仓库根目录。找到 git root 时，sessions 存储在 `<git-root>/.vole/sessions/`，使会话历史与项目共存。未找到 git root 时，CLI 回退到 `~/.vole/sessions/`。

Storage interface 保持抽象，这样后续实现可以使用 SQLite、cloud sync 或 encrypted storage。

## 6. Session Record

Session record 应包含：

- Session ID
- Created timestamp
- Updated timestamp
- Workspace root
- Entry adapter，例如 CLI
- Default autonomy mode
- Model provider summary
- Title 或 first user goal
- Message references
- Trace references

具体序列化方式可以在实现阶段选择，但 records 应是结构化且 versioned 的。

## 7. Message Record

Message records 应包含：

- Message ID
- Session ID
- Role：user、assistant、tool、system summary
- Timestamp
- Content
- Related tool call ID, if any
- Related trace event IDs, if any
- Redaction metadata when relevant

大型 tool outputs 不应总是作为普通 chat messages 存储。它们可以作为 tool result records 存储，并在 messages 中摘要。

## 8. Trace Record

Trace records 应与 sessions 关联。

Trace storage 应支持：

- 追加 events
- 加载最近 events
- 加载某个 user turn 的 events
- 按 visibility level 过滤
- 展示前脱敏敏感内容

Trace records 应结构化，让 CLI 和未来 Web UI 可以用不同方式渲染。

Phase 5 会把 trace records 存储在与 session messages 相同的 append-only JSONL file 中。这样 MVP 更容易检查：一个 session file 可以 replay conversation 和可见 execution timeline。

JSONL 文件包含四种记录类型：

```jsonl
{"type":"session","session":{…}}
{"type":"message","message":{"role":"user","content":"你好",…}}
{"type":"message","message":{"role":"assistant","content":null,"toolCalls":[{…}],…}}
{"type":"message","message":{"role":"tool","content":"结果","toolCallId":"tc_1",…}}
{"type":"compact_boundary","summary":"Conversation summary:\n…","messagesBefore":35,"messagesAfter":14,"createdAt":"…"}
{"type":"trace","traceEvent":{…}}
```

`compact_boundary` 记录标记 context compaction 发生的位置。重放时，store 清空之前所有消息并从摘要重新开始。这确保 compaction 只执行一次，其结果在进程重启后依然持久。

## 9. Tool Result Record

当输出很大或是结构化数据时，Tool results 可能需要自己的 records。

Tool result record 可以包含：

- Tool call ID
- Tool name
- Input summary
- Output summary
- Structured result data
- Source path or URL
- Error details
- Timing metadata

模型上下文通常应接收紧凑 observation，而不是完整 tool result。

## 10. Context Reconstruction

继续 session 时，Agent 需要重建有用上下文。

MVP context reconstruction 可以使用：

- 最近 user 和 assistant messages
- 最近 tool observations
- 最近 trace summaries
- 当前配置
- 当前加载的 skills

MVP 不应尝试检索所有历史数据。它应该保持上下文有边界。

未来版本可以增加 summarization、semantic retrieval 和 long-term memory。

## 11. Session Summaries

Session summaries 很有用，但对早期 MVP 是可选的。

后续版本可以为以下内容创建 summaries：

- 长对话
- 已完成任务
- 重要决策
- 可复用项目事实

Summaries 不应在没有 policy 和用户控制的情况下自动变成 long-term memory。

## 12. Privacy and Redaction

Session storage 可能包含敏感信息。

MVP 应该：

- 避免存储 API keys
- 在 trace 中脱敏 secret-like values
- 避免存储完整 secret-like file contents
- 明确 storage location
- 默认保持数据本地

未来版本可以增加 encryption 或 OS keychain integration。

## 13. Relationship to Memory

Session storage 是 memory 的基础，但不是完整 memory system。

后续 memory features 可以包括：

- User-approved memory writes
- Editable memory entries
- Forget/delete controls
- Semantic retrieval
- Local knowledge indexes
- Project-specific memory

将 memory 排除在 MVP 之外，可以让第一版 Agent 更容易理解、测试和信任。

## 14. CLI Behavior

CLI 最终应支持：

- 启动新 session
- 继续最新 session
- 列出最近 sessions
- 展示当前 session 的 trace
- 清除或删除 session

MVP 可以从以下能力开始：

- `vole chat` 时创建 session
- 持久化 messages 和 trace events
- 当前 session 的 `/trace`
- 未来 session listing command

## 15. 测试要求

Session storage 需要测试，因为它保护用户连续性和 trace history。

必需测试领域：

- 创建 sessions
- 追加 messages
- 追加 trace events
- 从 JSONL storage replay trace events
- 加载 sessions
- Context reconstruction boundaries
- 持久化或展示前 redaction
- 处理缺失或损坏的 session files
- Schema 变化时的 storage version migration
- 当前 session trace 的 CLI behavior
- Process restart 后 named-session trace 的 CLI behavior

任何改变 Agent Loop、Execution Trace、CLI chat 或 storage schema 的迭代，都应更新 session tests。

## 16. 验收标准

MVP session storage 成功标准：

- CLI chat session 有 session ID。
- User 和 assistant messages 可以持久化。
- Tool observations 可以关联到 session。
- Trace events 可以持久化和加载。
- `/trace` 可以展示最近 current-session events。
- Context reconstruction 有边界且可预测。
- Long-term memory 被明确延后。
- Session behavior 被 unit 和 integration tests 覆盖。

## 17. 相关文档

- [主设计](../product/vole-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)

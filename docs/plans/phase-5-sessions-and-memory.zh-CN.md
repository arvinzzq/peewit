# Phase 5 Sessions and Memory Plan

状态：Paused After Early Foundation
日期：2026-05-03

English version: [phase-5-sessions-and-memory.md](./phase-5-sessions-and-memory.md)

## Progress

状态：Paused After Early Foundation

Roadmap note：

Phase 5 已提前推进，用于提供 session、trace、workspace prompt 和 read-only memory foundations。后续 memory 扩展会暂停，等 Phase 2 tools/permissions 以及后续 planning/autonomy 支撑就绪后再继续。

已完成：

- 带 ordered message records 的 in-memory session store：`5ed6ca9`
- Context assembly 支持 recent session messages：`827a08d`
- Runtime handoff for recent messages：`3e0447a`
- 同一个 interactive session 内的 CLI short-term memory：`2a22822`
- `SessionStore` 后面的 durable JSONL session storage：`f311687`
- 由 JSONL storage 支撑的 CLI named sessions：`e634f54`
- Stores 和 CLI 中的 session listing：`08bc0ed`、`b3ecd92`
- Session stores 中的 durable trace events：`0b10494`
- CLI named-session trace persistence across process runs：`dd5a2a1`
- 使用 `chat --resume` 的 CLI latest-session resume：`325b8f2`
- 针对 `AGENTS.md` 和 `SOUL.md` 的 workspace prompt loading：`a2bca8e`、`719e805`、`15ce35c`
- Long-term memory disabled/read-only policy and CLI visibility：`b737c68`、`db89088`
- Policy enabled 时只读加载 `USER.md` 和 `MEMORY.md`：`fafe13f`
- Policy enabled 时只读加载今天/昨天 daily memory：`7d38ccc`

剩余：

- Daily memory write policy 和未来 daily note creation。

最新验证：

- `pnpm run check`
- `pnpm vitest run packages/sessions/src/index.test.ts`
- `pnpm vitest run packages/context/src/index.test.ts`
- `pnpm vitest run packages/core/src/index.test.ts`
- `pnpm vitest run apps/cli/src/index.test.ts`

Phase 5 恢复时的下一步建议切片：

- 在创建或更新 `memory/YYYY-MM-DD.md` 前定义 daily memory write policy。

## 1. 目的

这个阶段让 ArvinClaw 拥有 short-term 和 durable memory。

OpenClaw-like 目标是一个用户可见的 Agent workspace，其中 sessions、memory、identity、user preferences 和 daily notes 都可以由用户检查和控制。

## 2. 用户结果

用户应该可以：

- 继续对话而不丢失最近 turns。
- 检查或恢复之前的 sessions。
- 理解 Agent 使用了什么 context。
- 批准未来任何 long-term memory writes。

## 3. 范围

这个阶段包括：

- Session records。
- Message records。
- Durable session storage。
- Context assembly 中的 recent conversation history。
- Trace persistence hooks。
- Session resume commands。
- 后续 workspace memory files。

这个阶段不包括：

- 静默 long-term memory writes。
- Background memory promotion。
- Multi-agent memory sharing。
- Remote memory sync。

## 4. Short-Term Memory

Short-term memory 指当前 session 中的 recent conversation messages。

当前第一切片：

```text
CLI interactive session
  -> read recent session messages
  -> pass recent messages to AgentRuntime
  -> ContextAssembler places them before the current user message
  -> after the turn, append user and assistant messages to the session
```

Configured CLI chat 现在使用 durable JSONL storage。Named sessions 可以这样选择：

```bash
pnpm run cli chat --session my_session
```

最近更新的 stored session 可以这样恢复：

```bash
pnpm run cli chat --resume
```

如果未指定 session，CLI 会创建一个通用的 `session_<id>` session。Session ID 是 agent-level identifier，不应该编码 CLI 或 Web UI 这样的 entry adapter。默认 storage directory 是 `~/.arvinclaw/sessions`。

Configured CLI chat 也会在文件存在时，从 configured workspace root 加载 `AGENTS.md` 和 read-only `SOUL.md`。Workspace root 可以通过 `ARVINCLAW_WORKSPACE_ROOT` 设置。

Long-term memory files 默认保持 disabled。`ARVINCLAW_LONG_TERM_MEMORY=read-only` 会在文件存在时，从 configured workspace root 加载 `USER.md`、`MEMORY.md`、`memory/<today>.md` 和 `memory/<yesterday>.md`，但 memory writes 仍保持 disabled。

## 5. Durable Session Storage

Durable target 是类似 OpenClaw replayable session 方向的 JSONL session storage。

初始 storage shape：

```text
~/.arvinclaw/sessions/
  <session-id>.jsonl
```

每一行应是结构化 record，例如：

```json
{"type":"message","id":"msg_1","sessionId":"sess_1","role":"user","content":"Hello","createdAt":"..."}
```

JSONL store 是 append-only 的，这样 session 可以按顺序 replay，后续也可以加入 trace 或 tool records，而不需要重写历史。

Trace records 使用与 messages 相同的 JSONL file。这样每个 named session 都能从一个 append-only file replay，并让 CLI process 重启后 `/trace` 仍然可用。

## 6. Long-Term Memory

Long-term memory 应在 durable sessions 之后实现。

计划中的 OpenClaw-like files：

- `USER.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

Agent 不能静默写入这些文件。Memory promotion 应该是 explicit 且 reviewable 的。

## 7. 测试

必需测试：

- Session creation and message ordering。
- Recent message limits。
- Stores 的 defensive copies。
- 带 recent messages 的 context assembly order。
- Runtime pass-through of recent messages。
- CLI second-turn provider request includes first-turn history。
- JSONL append/load behavior。
- 写入文件前拒绝 unsafe session ID。
- CLI named sessions 可以跨 process runs 持久化 history。
- Session listing 按最近更新时间展示 stored sessions。
- `SessionStore` 和 configured CLI chat 中的 trace persistence。
- `/trace` 可以在 process restart 后 replay named session 的 persisted trace。
- CLI `chat --resume` 会继续最近更新的 stored session。
- Workspace prompt files 存在时会进入 configured-provider context。
- Long-term memory file access 由 policy gate 控制，并可通过 `/config` 查看。
- `USER.md` 和 `MEMORY.md` 只会在 read-only long-term memory mode 中进入 context。
- 今天和昨天的 daily memory files 只会在 read-only long-term memory mode 中进入 context。

## 8. 验收标准

这个阶段完成时：

- Sessions 可以跨 process runs 持久化。
- CLI 可以恢复 stored session。
- Recent session history 会进入 context。
- Trace 和 message history 可以被检查。
- 在实现任何 long-term memory writes 前，已经记录 long-term memory write policy。

## 9. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Memory System](../architecture/memory-system.zh-CN.md)
- [Session Storage](../architecture/session-storage.zh-CN.md)
- [Context Engine](../architecture/context-engine.zh-CN.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.zh-CN.md)

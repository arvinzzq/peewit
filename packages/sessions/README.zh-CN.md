# Sessions Package

English version: [README.md](./README.md)

## 架构概述

`@vole/sessions` 负责**会话持久化边界**：以会话为范围存储对话消息和运行时 trace 事件，将持久化关注点与运行时编排、权限逻辑和 UI 渲染完全分离。

```
CLI / Web adapter
    │  存储消息和 trace 事件
    ▼
SessionStore（接口）
    ├─ InMemorySessionStore   （进程内，用于测试和临时使用）
    └─ JsonlSessionStore      （JSONL 文件，用于持久化）
```

## 核心概念

### Session、Message、TraceEvent

`SessionRecord` 是顶层容器，含 `id`、可选 `title`、`createdAt`、`updatedAt`（每次追加消息或事件时更新）。

`SessionMessageRecord` 是一轮对话，含 `id`、`sessionId`、`role`（user/assistant/tool/system）、`content`（可为 `null`）、可选的 `toolCalls`（助手消息的工具调用列表）、可选的 `toolCallId`（tool 角色消息对应的工具调用 ID）、`createdAt`。`content` 在助手消息仅含工具调用（无文本）时为 `null`。

`SessionTraceEventRecord<TEvent>` 是对任意事件类型的泛型包装（通常是 `@vole/core` 的 `RuntimeEvent`）。

### SessionStore 接口

所有操作均为 async：`createSession`、`getSession`、`listSessions`（按 `updatedAt` 降序）、`appendMessage`、`listMessages`（`limit` 从尾部截取）、`appendTraceEvent`、`listTraceEvents`（`limit` 从尾部截取）、`appendCompactBoundary`（写入 `compact_boundary` 记录，CLI 适配器在检测到带摘要的 `compaction_triggered` 事件时调用）。

## 实现原理

### InMemorySessionStore

三个以 session ID 为键的 `Map`（sessions、messages、traceEvents）。所有返回记录均为浅拷贝（spread），trace 事件经 `structuredClone` 防止突变。ID 和时间戳可注入，保证测试确定性。

### JsonlSessionStore — JSONL 格式

每个 session 存储为独立的 JSONL 文件 `{directory}/{sessionId}.jsonl`，每行是一条带类型判别符的 JSON 记录：

```jsonl
{"type":"session","session":{…}}
{"type":"message","message":{"role":"user","content":"你好",…}}
{"type":"message","message":{"role":"assistant","content":null,"toolCalls":[{…}],…}}
{"type":"message","message":{"role":"tool","content":"结果","toolCallId":"tc_1",…}}
{"type":"compact_boundary","summary":"Conversation summary:\n…","messagesBefore":35,"messagesAfter":14,"createdAt":"…"}
{"type":"trace","traceEvent":{…}}
```

四个重要特性：
1. **仅追加写入**：每次 `appendMessage`、`appendTraceEvent`、`appendCompactBoundary` 操作仅新增一行，永不修改或删除已有行。
2. **可重放**：`#replay()` 方法按顺序读取所有行即可重建完整 session 状态。遇到 `compact_boundary` 记录时，清空已积累的 messages 数组，以 summary 作为 `role: "system"` 的第一条消息重新开始。因此 `listMessages()` 只返回 boundary 之后的消息。
3. **崩溃容错**：进程崩溃时最多末尾出现一行不完整数据，之前数据不受影响。
4. **完整工具上下文保留**：适配器持久化每轮对话的所有消息（user、含 `toolCalls` 的 assistant、含 `toolCallId` 的 tool），不只是最终的 user+assistant 对。这确保 session 恢复时可以重建完整的工具调用上下文。

### 每次读取都重放

`JsonlSessionStore` 不维护进程内缓存。每次读取操作都重放 JSONL 文件，比缓存失效更简单安全，适合项目级工作负载。

### Session ID 安全性

`assertSafeSessionId(sessionId)` 验证 ID 匹配 `^[A-Za-z0-9_-]+$`，无路径分隔符、无点、无特殊字符，防止目录遍历攻击。

### 会话列表

`JsonlSessionStore` 的 `listSessions` 读取目录中所有 `.jsonl` 文件，逐一重放获取 `updatedAt`，按降序排列。时间复杂度为 O(n × 文件大小），对交互式会话列表（n 较小）可接受。

### Session 存储位置

`EffectiveConfig` 的 `sessions.directory` 字段控制 JSONL 文件的写入位置，默认为 `~/.vole/sessions`，Adapter 可在构建 store 前覆盖此值。

CLI Adapter（`apps/cli/src/index.ts`）实现了**项目维度 Sessions**：启动时向上遍历目录树查找 `.git` 目录（`findGitRoot()`）。若找到 git 根目录，sessions 存储到 `<git-root>/.vole/sessions/`，使 session 历史随仓库存放；否则回退到全局 `~/.vole/sessions/`。该检测逻辑完全位于 CLI Adapter 层——`@vole/sessions` 包本身与存储位置无关，只负责向给定目录写入文件。

### 防御性副本

两种存储实现始终返回记录副本（spread / `structuredClone`），防止调用者突变存储状态。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 sessions 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 sessions 包。 |
| `src/index.ts` | Session 存储 | 所有导出：`SessionRecord`、`SessionMessageRecord`、`SessionTraceEventRecord`、`SessionStore`、`InMemorySessionStore`、`JsonlSessionStore`、相关依赖类型。 |
| `src/index.test.ts` | Session 测试 | 保护创建/列表/获取、消息顺序、trace 持久化、`limit` 查询、`updatedAt` 更新、防御性副本、JSONL 重放、不安全 ID 拒绝、`compact_boundary` 重放（消息重置为摘要）以及 `toolCalls`/`toolCallId` 字段持久化。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

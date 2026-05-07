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

`SessionMessageRecord` 是一轮对话，含 `id`、`sessionId`、`role`（user/assistant/tool/system）、`content`、`createdAt`。

`SessionTraceEventRecord<TEvent>` 是对任意事件类型的泛型包装（通常是 `@vole/core` 的 `RuntimeEvent`）。

### SessionStore 接口

所有操作均为 async：`createSession`、`getSession`、`listSessions`（按 `updatedAt` 降序）、`appendMessage`、`listMessages`（`limit` 从尾部截取）、`appendTraceEvent`、`listTraceEvents`（`limit` 从尾部截取）。

## 实现原理

### InMemorySessionStore

三个以 session ID 为键的 `Map`（sessions、messages、traceEvents）。所有返回记录均为浅拷贝（spread），trace 事件经 `structuredClone` 防止突变。ID 和时间戳可注入，保证测试确定性。

### JsonlSessionStore — JSONL 格式

每个 session 存储为独立的 JSONL 文件 `{directory}/{sessionId}.jsonl`，每行是一条带类型判别符的 JSON 记录：

```jsonl
{"type":"session","session":{…}}
{"type":"message","message":{…}}
{"type":"trace","traceEvent":{…}}
```

三个重要特性：
1. **仅追加写入**：每次 append 操作仅新增一行，永不修改或删除已有行。
2. **可重放**：`#replay()` 方法按顺序读取所有行即可重建完整 session 状态。
3. **崩溃容错**：进程崩溃时最多末尾出现一行不完整数据，之前数据不受影响。

### 每次读取都重放

`JsonlSessionStore` 不维护进程内缓存。每次读取操作都重放 JSONL 文件，比缓存失效更简单安全，适合项目级工作负载。

### Session ID 安全性

`assertSafeSessionId(sessionId)` 验证 ID 匹配 `^[A-Za-z0-9_-]+$`，无路径分隔符、无点、无特殊字符，防止目录遍历攻击。

### 防御性副本

两种存储实现始终返回记录副本（spread / `structuredClone`），防止调用者突变存储状态。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 sessions 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 sessions 包。 |
| `src/index.ts` | Session 存储 | 所有导出：`SessionRecord`、`SessionMessageRecord`、`SessionTraceEventRecord`、`SessionStore`、`InMemorySessionStore`、`JsonlSessionStore`、相关依赖类型。 |
| `src/index.test.ts` | Session 测试 | 保护创建/列表/获取、消息顺序、trace 持久化、`limit` 查询、`updatedAt` 更新、防御性副本、JSONL 重放和不安全 ID 拒绝。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

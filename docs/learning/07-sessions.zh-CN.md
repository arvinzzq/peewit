# 模块 07：@vole/sessions

状态：已完成
日期：2026-05-07

英文版本：`07-sessions.md`

相关源码：`packages/sessions/src/index.ts`

## 0. 如何使用本文档

本文档属于[学习指南](./guide.zh-CN.md)第三阶段（基础模块）的一部分。
请在阅读 [06-context.zh-CN.md](./06-context.zh-CN.md) 之后阅读本文档——上下文组装将会话消息作为 `recentMessages` 使用，而这些消息正是由本模块提供的。

**阅读前**：完整阅读 `packages/sessions/src/index.ts`。注意其中有两个存储实现：`InMemorySessionStore` 和 `JsonlSessionStore`。

**重点问题**：
- JSONL 格式是什么，为什么在这里使用它？
- `#replay()` 做了什么，它的性能影响是什么？
- 为什么 `SessionMutex` 在 `@vole/core` 而不是这里？
- `SessionMessageRecord` 和 `ModelMessage` 有什么区别？

**检查点**：当你能够描述会话文件在磁盘上的样子，并且能追踪一次 `listMessages()` 调用通过 `#replay()` 方法的全过程时，说明你理解了本模块。

## 1. 通俗易懂：这个模块做什么

**打个比方**：会话就像一本日记本。每次对话有一本日记本（一个文件）。内容只往后面追加，从不擦除。想要了解当前状态，就从头把日记翻一遍。这样的好处是：写入崩溃安全（即使突然断电，之前的记录完好无损），而且存储格式人类可读——你可以直接打开原始文件，看清楚每一步发生了什么。

**技术概要**：`@vole/sessions` 将对话历史和运行时追踪事件持久化到磁盘。它提供了两种 `SessionStore` 实现：用于测试的内存存储，以及用于生产的 JSONL 文件存储。每个会话是一个单一的追加写入 `.jsonl` 文件，包含三种记录类型：会话元数据、消息和追踪事件。

## 2. 为什么需要它

没有会话存储，agent 在两次对话之间没有记忆。当一次新对话开始时，适配器无法重新加载对话历史传给上下文组装的 `recentMessages`。agent 每次对话都会从零开始。

`@vole/sessions` 同时也是执行追踪（运行时事件）的持久化层。追踪记录让适配器能够展示对话历史、回放运行过程，以及调试过去某一轮发生了什么。

## 3. 公共接口

```ts
interface SessionStore {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>
  getSession(sessionId: string): Promise<SessionRecord | undefined>
  listSessions(query?: ListSessionsQuery): Promise<SessionRecord[]>

  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>
  listMessages(sessionId: string, query?: ListSessionMessagesQuery): Promise<SessionMessageRecord[]>

  appendTraceEvent<TEvent>(input: AppendSessionTraceEventInput<TEvent>): Promise<SessionTraceEventRecord<TEvent>>
  listTraceEvents<TEvent>(sessionId: string, query?: ListSessionTraceEventsQuery): Promise<SessionTraceEventRecord<TEvent>[]>
}

interface SessionRecord {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

interface SessionMessageRecord {
  id: string
  sessionId: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  createdAt: string
}

interface SessionTraceEventRecord<TEvent = unknown> {
  sessionId: string
  event: TEvent      // 泛型 — 可以存储任意 RuntimeEvent
  createdAt: string
}
```

两种实现：`InMemorySessionStore`（用于测试）和 `JsonlSessionStore`（用于生产，需要提供 `directory` 路径）。

## 4. 实现详解

### 磁盘格式

每个会话存储在一个 `.jsonl` 文件中（`<sessionId>.jsonl`）。每行是一个完整的 JSON 对象。三种记录类型共享同一个文件：

```jsonl
{"type":"session","session":{"id":"sess_abc","createdAt":"2026-05-07T10:00:00Z","updatedAt":"..."}}
{"type":"message","message":{"id":"msg_1","sessionId":"sess_abc","role":"user","content":"你好",...}}
{"type":"message","message":{"id":"msg_2","sessionId":"sess_abc","role":"assistant","content":"你好！",...}}
{"type":"trace","traceEvent":{"sessionId":"sess_abc","event":{"type":"run_started",...},...}}
```

### 重放模式

每次 `JsonlSessionStore` 的读取操作都会调用 `#replay(sessionId)`：

```ts
async #replay(sessionId) {
  const content = await readFile(filePath, "utf8")

  for (const line of content.split("\n")) {
    const record = JSON.parse(line)
    if (record.type === "session")  session = record.session
    if (record.type === "message")  messages.push(record.message)
    if (record.type === "trace")    traceEvents.push(record.traceEvent)
  }

  return { session, messages, traceEvents }
}
```

没有内存缓存。每次调用 `listMessages()`、`appendMessage()` 或 `listTraceEvents()` 都会从磁盘重新读取并解析整个文件。

### 追加写入

```ts
async #append(sessionId, record) {
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, JSON.stringify(record) + "\n", { flag: "a" })
}
```

`flag: "a"` 以追加模式打开文件。写入操作永远不会覆盖已有的行。如果进程在写入过程中崩溃，之前的记录完好无损，可以恢复。

### 会话 ID 安全校验

```ts
function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error(...)
}
```

在构建文件路径之前调用。当会话 ID 来自用户输入时，防止 `../../../etc/passwd` 之类的路径穿越攻击。

## 5. OpenClaw 对照

| OpenClaw | Vole | 说明 |
|---|---|---|
| `session-store.ts` | `JsonlSessionStore` | 持久化会话存储 |
| 会话级写入锁 | `@vole/core` 中的 `SessionMutex` | 并发控制在更高层 |
| 对话记录持久化 | `appendMessage` / `listMessages` | 相同概念 |
| 每会话执行追踪 | `appendTraceEvent` / `listTraceEvents` | OpenClaw 追踪更详细 |

OpenClaw 的会话存储使用 SQLite 支持索引查询和并发访问。Vole 使用追加写入 JSONL 文件，检查和调试更简单，但每次读取都需要重建状态。

## 6. 关键设计决策

**JSONL 追加写入格式**

JSONL（JSON Lines）每行存储一个 JSON 对象。文件是只追加写入的：新记录追加到文件末尾，旧记录从不被修改。这带来了：
- **崩溃安全**：文件末尾的部分写入不会影响之前所有的记录。即使最后一行损坏，之前的内容都可以恢复。
- **人类可读**：你可以直接用 `cat` 查看会话文件，读取完整的对话历史。
- **无需迁移**：格式是一系列有类型的记录；新的记录类型可以直接添加，不会破坏已有文件。

**每次读取都重放 — 无缓存**

`JsonlSessionStore` 每次操作都重新读取并解析整个文件。调用之间没有内存状态。这种设计简单且正确，但随着会话增长，读取开销是线性的。对于几百条消息的会话是合适的；对于几万条消息的会话会比较慢。

权衡：没有缓存意味着没有缓存失效 bug，没有过期读取，也没有因常驻内存会话带来的内存压力。

**`SessionMutex` 在 `@vole/core` 而不是这里**

sessions 包没有并发保护。`SessionMutex` 由 `AgentRuntime` 持有。这样的分离很清晰：sessions 是纯粹的存储，没有并发逻辑；core 是协调者，决定什么时候可以执行运行。

如果 sessions 有自己的互斥锁，它就需要了解运行边界——而这些知识属于 core。

**`SessionTraceEventRecord` 是泛型**

```ts
interface SessionTraceEventRecord<TEvent = unknown> { event: TEvent }
```

sessions 包不从 `@vole/core` 导入。它存储传入 `appendTraceEvent` 的任何事件。这防止了循环依赖（core → sessions，sessions → core），并让存储层可以与任意事件类型一起使用。

## 7. 测试方式

测试在 `packages/sessions/src/index.test.ts` 中。`InMemorySessionStore` 在不涉及文件系统的情况下测试正确性。`JsonlSessionStore` 测试使用真实的临时目录（`mkdtemp`）——不模拟 Node.js 文件 API。

测试类别：
- 会话创建和检索
- 消息追加和列表（顺序、限制）
- 追踪事件追加和列表
- JSONL 文件格式验证（原始文件内容断言）
- `updatedAt` 从追加记录中推导
- 会话 ID 安全校验
- 缺失会话文件返回空（不报错）

## 8. 深入洞察

**重放模式是事件溯源的一种形式。** JSONL 文件是一个不可变的事件日志。状态（当前消息、当前追踪）通过重放日志来推导。这与事件溯源数据库和 Kafka 消费者使用的模式相同——日志是真相的来源，而不是内存中的表示。

**`SessionMessageRecord` 和 `ModelMessage` 是不同的类型。** `SessionMessageRecord` 是一个持久化记录，有 `id`、`sessionId` 和 `createdAt`。`ModelMessage` 是发送给模型 API 的实时负载，有 `role`、`content` 以及可选的 `toolCalls`/`toolCallId`。适配器负责转换：它从存储中读取 `SessionMessageRecord[]`，映射成 `ModelMessage[]` 后传给上下文组装的 `recentMessages`。

**`updatedAt` 在重放时推导，而不是单独存储。** `SessionRecord` 的 `updatedAt` 在 `#replay()` 过程中根据消息和追踪事件中最新的 `createdAt` 时间戳更新。这意味着 `updatedAt` 始终与实际活动一致，而不是与可能过期的存储值一致。

**会话 ID 是安全边界。** 如果会话 ID 来自用户输入且包含 `../`，就会解析到会话目录之外的路径。`assertSafeSessionId` 在构建文件路径时阻止这种情况——这是针对通过会话 ID 注入的防御。

## 9. 复习问题

1. JSONL 格式是什么？为什么用它来存储会话，而不是单个 JSON 文件或数据库？
   > JSONL = 每行一个 JSON 对象。追加写入是崩溃安全的（部分写入不会影响之前的记录）。不需要迁移（新记录类型可以直接添加而不破坏已有文件）。无需特殊工具即可人类阅读。单个 JSON 文件每次写入都需要重写整个文件。数据库增加了依赖复杂性。

2. `#replay()` 做了什么？对于有 N 条记录的会话，它的时间复杂度是多少？
   > 读取整个会话文件，解析每一行，重建会话状态（会话元数据、所有消息、所有追踪事件）。时间和 I/O 复杂度：每次读取操作 O(N)，无论需要哪些记录。

3. 为什么 `SessionMutex` 在 `@vole/core` 而不是 `@vole/sessions` 中？
   > 互斥锁属于运行协调层，而不是存储层。Sessions 存储数据；core 决定什么时候可以执行运行。如果 sessions 持有互斥锁，它就需要理解运行边界——而这些知识属于 core。将它们分离防止了循环依赖，并维护了清晰的边界。

4. `SessionMessageRecord` 和 `ModelMessage` 有什么区别？
   > `SessionMessageRecord` 是持久化记录：有 `id`、`sessionId`、`createdAt` 和持久化的 `content`。`ModelMessage` 是发给模型 API 的实时负载：有 `role`、`content` 以及可选的 `toolCalls`/`toolCallId`。适配器将 `SessionMessageRecord[]` 映射成 `ModelMessage[]`，然后传给上下文组装。

5. 为什么 `SessionTraceEventRecord<TEvent>` 是泛型而不是类型化为 `RuntimeEvent`？
   > 为了避免循环依赖：`@vole/core` 依赖 `@vole/sessions` 进行存储，而 `@vole/sessions` 不能从 `@vole/core` 导入。泛型类型参数让 sessions 可以存储任意事件而无需了解其结构，保持了包之间的解耦。

6. 如果一个会话 JSONL 文件的最后一行损坏（例如崩溃时写入到一半），会发生什么？
   > `#replay()` 对每一行调用 `JSON.parse(line)`。损坏的行会抛出解析错误，传播给调用者。当前实现不会跳过损坏的行。恢复需要手动从文件中删除损坏的最后一行。

# 模块 15：apps/web

状态：已完成
日期：2026-05-07

英文版：`15-web.md`

相关源码：`apps/web/src/server.ts`、`apps/web/src/client/App.tsx`

## 0. 如何使用本文档

本文档属于学习指南第五阶段（系统综合）。
请在 [14-cli.zh-CN.md](./14-cli.zh-CN.md) 之后阅读——两个 adapter 用不同的传输层解决同一个问题。
它们之间的对比是这里最主要的学习价值。

**阅读前**：通读 `server.ts`（481 行）。特别关注 `WebApprovalResolver`——这是最有趣的部分。
然后浏览 `App.tsx` 了解客户端。注意 `createWebSession` 与 CLI 的 `createConfigured` 的共同之处，
以及它省略了什么。

**聚焦问题**：
- `WebApprovalResolver` 有 `resolve()` 和 `settle()`。两个独立的 HTTP 请求如何协调完成单个 Promise？
- 服务器有两个存储层：`sessions` Map 和 `sharedStore`。各存什么？进程重启后各自会怎样？
- SSE turn 处理器只持久化 `user` 和 `assistant` 消息，不持久化工具调用。这与 CLI 有何不同，浏览器因此损失了什么？
- WebSocket 处理器做了与 SSE 处理器相同的 turn 逻辑。为什么服务器需要两个？

**检查点**：能够描述从浏览器发送消息到流式文本逐字符出现的完整路径，包括所有网络跳转和每步由哪个包处理，即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：Web adapter 是双语翻译。Agent 用 runtime events 说话；浏览器用 HTTP/JSON 和 SSE 文本流说话。
Web adapter 在两者之间翻译——接收 HTTP POST 请求，调用 `AgentRuntime.runTurn`，将产生的事件实时流式传输
回浏览器。浏览器的 React 应用读取这些事件并更新 UI，无需等待完整响应。

**技术总结**：`apps/web` 是浏览器适配器。服务器（`server.ts`）是一个 Hono HTTP 应用，暴露 session、
turn 和审批的 REST+SSE API，加上 WebSocket endpoint 用于双向通信。`WebApprovalResolver` 使用 Promise
将 agent runtime 的同步审批请求桥接到浏览器的异步 HTTP POST。客户端（`App.tsx`）是一个 React 应用，
创建 session，通过 SSE 流式传输 turn 事件，并内联渲染审批提示。

## 2. 架构：两个存储层

Web 服务器维护两个不同的存储层：

```
sessions Map（模块级）           sharedStore（JsonlSessionStore）
────────────────────────────    ─────────────────────────────────
进程内，内存中                    持久，磁盘支持的 JSONL 文件
由 POST /api/sessions 创建       跨所有 session 共享
保存：AgentRuntime、             保存：session 元数据、
      WebApprovalResolver、            消息历史、
      InMemoryRuntimeTraceStore        trace 事件
进程重启后丢失                    进程重启后存活
```

这是与 CLI 的关键区别。CLI 的 `CliChatSession` 将两层融合为一个对象。Web 服务器将它们分开：
持久数据进入 `sharedStore`；瞬态 runtime 状态进入 `sessions`。进程重启时，`sharedStore` 存活但
`sessions` 为空——下次对已有 session 的 turn 请求会调用 `createWebSession(config, id)` 从头重建
瞬态状态。

## 3. WebApprovalResolver：Promise 桥接

```ts
class WebApprovalResolver implements ApprovalResolver {
  readonly #pending = new Map<string, { request, resolve }>();

  resolve(request: ApprovalRequest): Promise<ApprovalResolution> {
    return new Promise<ApprovalResolution>((resolve) => {
      this.#pending.set(request.call.id, { request, resolve });
      // Promise 在此挂起——agent runtime 暂停等待
    });
  }

  settle(callId: string, decision: ApprovalResolution): boolean {
    const entry = this.#pending.get(callId);
    if (entry === undefined) return false;
    this.#pending.delete(callId);
    entry.resolve(decision);  // 恢复 agent runtime
    return true;
  }
}
```

**两个 HTTP 请求如何协调完成一个 Promise**：

1. 浏览器发送 `POST /api/sessions/:id/turns` → SSE 流打开
2. Agent runtime 调用中风险工具 → 调用 `resolver.resolve(request)` → Promise 挂起
3. SSE 流向浏览器发出 `approval_requested` 事件
4. 浏览器渲染审批 UI，用户点击批准/拒绝
5. 浏览器发送 `POST /api/sessions/:id/approvals`，携带 `{ callId, approved }`
6. 服务器调用 `resolver.settle(callId, decision)` → Promise 解决
7. Agent runtime 恢复，工具执行或被拒绝
8. SSE 流继续后续事件

SSE 流（步骤 1）在整个 turn 期间保持开放。审批 REST 调用（步骤 5）是一个独立的 HTTP 请求，解决了
挂起的 Promise。两个请求只通过 `WebApprovalResolver` 的 map 连接，以 `callId` 为键。

## 4. API Endpoints

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/sessions` | 创建新 session 或恢复已有（body: `{ sessionId? }`） |
| `GET` | `/api/sessions` | 从持久 store 列出所有 session |
| `GET` | `/api/sessions/:id` | 单个 session 元数据 |
| `GET` | `/api/sessions/:id/messages` | 消息历史 |
| `POST` | `/api/sessions/:id/turns` | 运行 turn——响应是 runtime 事件的 SSE 流 |
| `POST` | `/api/sessions/:id/approvals` | 处理待定审批 |
| `GET` | `/api/gateway/sessions` | 从 gateway 列出活跃 session |
| `GET /ws/:id` | WebSocket | 双向：发送 turn + 审批，接收事件 |

## 5. SSE Turn 处理器

Phase 11 Step 5b 起，turn 提交给 `GatewayCore` 而不是直接调用 `runtime.runTurn`。Gateway 把它穿过 `@vole/lanes` 的 global / subagent / session 三层 lane 链。`runningTurns` 现在按 session 存储活跃的 `runId`，`DELETE /api/sessions/:id/turns` 调用 `webGateway.cancel(runId)`，让取消通过 gateway 的 `AbortController` 流转到 `runTurn`。

```ts
app.post("/api/sessions/:id/turns", async (c) => {
  const recentMessages = await store.listMessages(id, { limit: 12 });
  const runId = `run_${crypto.randomUUID()}`;
  runningTurns.set(id, runId);

  return streamSSE(c, async (stream) => {
    const eventStream = webGateway.submit<RuntimeEvent>({
      runId,
      sessionKey: id,
      agentId: "default",
      run: async function* (signal) {
        for await (const event of runtime.runTurn({ sessionId: id, recentMessages, message, signal })) {
          yield event;
        }
      }
    });

    for await (const event of eventStream) {
      await session.traceStore.append(event);
      await store.appendTraceEvent({ sessionId: id, event });
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      if (event.type === "run_completed" || event.type === "run_failed") break;
    }

    // turn 完成后只持久化 user + assistant 消息
    await store.appendMessage({ sessionId: id, role: "user", content: message });
    if (assistantText !== "") {
      await store.appendMessage({ sessionId: id, role: "assistant", content: assistantText });
    }
    webGateway.touch(id);
    runningTurns.delete(id);
  });
});
```

**Web adapter 相比 CLI 省略了什么**：

CLI 的 `sendMessage` 从 `turn_complete` 持久化所有消息——用户、工具调用、工具结果和 assistant。
Web SSE 处理器只持久化用户消息和最终 assistant 文本。工具调用和工具结果作为 SSE 事件发送到浏览器，
但不存储在 JSONL 文件中。

这意味着浏览器可以在 session 期间显示完整 trace，但恢复时加载的消息历史（`GET /api/sessions/:id/messages`）
只显示用户/assistant 对，不显示中间工具步骤。

## 6. WebSocket 替代方案

WebSocket endpoint（`/ws/:id`）提供双向通信：
- 客户端发送 `{ type: "turn", message }` → 服务器运行 turn，将事件作为 JSON 帧发送
- 客户端发送 `{ type: "approval", callId, approved, reason }` → 服务器处理审批
- 服务器将 runtime 事件作为 JSON 帧发送，每个事件一帧

WebSocket 和 SSE 覆盖相同用途，但有不同权衡：

| | SSE | WebSocket |
|---|---|---|
| 方向 | 仅服务器→客户端 | 双向 |
| 审批流程 | 独立 REST POST | 内联 WS 消息 |
| 协议 | HTTP/1.1 + 分块 | 升级 TCP |
| 重连 | 浏览器自动重连 | 手动 |

SSE 对读取密集型用途更简单（观察 turn 流）。WebSocket 更适合客户端需要在流中发送数据的交互用途
（审批、取消）。

## 7. 客户端：React App（App.tsx）

客户端是一个两视图 React SPA：

**`SessionsPage`**：从 `GET /api/sessions` 列出 session，提供"新建 Session"和"恢复"按钮。
通过 `POST /api/sessions` 创建 session。

**`ChatView`**：主界面。挂载时获取消息历史。提交时发送 `POST /api/sessions/:id/turns` 并处理 SSE 流：

```ts
if (event.type === "token_delta")          setStreamingText(prev => prev + event.delta)
if (event.type === "tool_started")         setCurrentTool(event.toolName)
if (event.type === "approval_requested")   setPendingApproval({ callId, ... })
if (event.type === "assistant_message_created") 添加到消息列表
```

审批内联处理：当 `approval_requested` 到达时，UI 渲染审批卡片。用户点击批准/拒绝 →
`POST /api/sessions/:id/approvals` → SSE 流继续。

## 8. 与 CLI 的对比

| 关注点 | CLI | Web |
|---|---|---|
| 审批 | readline 提示，阻塞 | Promise 桥接 + REST settle |
| 持久化 | 所有消息（用户 + 工具 + assistant） | 仅用户 + assistant |
| 压缩边界持久化 | 是（`appendCompactBoundary`） | 否 |
| 工具集 | 完整 + memory + heartbeat | 较小（无 edit_file、search_files、heartbeat） |
| 流式渲染 | 缓冲文本输出 | 实时 `token_delta` → React 状态 |
| Session 工厂 | `createConfigured` / `createFake` | `createWebSession`（仅真实） |
| 可测试性 | 通过 `RunCliOptions` 完全注入 | 当前未注入 |

Web adapter 最显著的遗漏是缺少压缩边界持久化。如果上下文压缩在 Web turn 期间触发，
`compact_boundary` 记录不会写入 JSONL 文件——下次 session 加载将回放完整的未压缩历史。

## 9. 关键设计决策

**用 Hono，不用 Express**

Hono 是轻量级 TypeScript 原生框架，内置 SSE 支持（`streamSSE`）和简洁的中间件 API。
`@hono/node-server` 适配器将 Hono 基于 Web API 的 fetch 处理器桥接到 Node.js 的 HTTP 服务器，
在同一端口上支持 WebSocket 升级。

**`WebApprovalResolver` 作为每个 session 的单例**

每个 session 一个 `WebApprovalResolver`（而非一个全局）。这隔离了审批状态——两个并发 session
不会意外地处理彼此的审批。resolver 在 `createWebSession` 中创建，存在于 `sessions` Map 条目中。

**Turn 请求时懒惰重建 runtime**

如果 session 存在于持久 store 中但不在 `sessions` Map 中（进程重启了），turn 处理器调用
`createWebSession(config, id)` 重建瞬态 runtime。这意味着 Web 服务器静默从重启中恢复——
客户端重试 turn，服务器从配置 + session ID 重建 runtime。

**Web 始终 `preferStreaming: true`**

Web adapter 对 `AgentRuntime` 始终设置 `preferStreaming: true`。这启用了 `token_delta` 事件，
驱动逐字符流式 UI。CLI 默认为 `false`，只在 Ink 渲染路径启用（不在纯文本路径）。

## 10. 洞察

**审批机制是构建 Web Agent Adapter 中最难的部分。** 终端中的交互式审批是同步的：agent 暂停，
人工输入，agent 恢复。在浏览器中没有同步通道。`WebApprovalResolver` 通过将 agent 挂起在 Promise 中
并提供 REST endpoint 来解决它。浏览器客户端轮询 SSE 流检测暂停并渲染审批 UI。这是 Web agent 中
"异步人在回路"的规范模式。

**SSE 比 WebSocket 更简单，适合流式 agent 输出。** Agent 发出事件；浏览器读取它们。这天然是单向的——
SSE 是正确的协议。WebSocket 增加了复杂性（升级处理、消息帧、重连），除非客户端需要在流中发送数据，
否则没有好处。Vole 两者都提供，让开发者根据用途选择。

**Web adapter 与 CLI 不完全对称。** 缺失：压缩边界持久化、工具调用/结果持久化、`update_heartbeat`、
`edit_file`、`search_files`、`append_daily_memory`。这些遗漏反映了 Web adapter 更简单的范围——
浏览器聊天 UI，而非完整的 agent 工作站。生产级 Web adapter 会补上这些差距。

## 11. 复习问题

1. 浏览器发送 `POST /api/sessions/:id/turns`。Agent runtime 调用需要审批的工具。追踪直到工具执行的完整序列。
   > （1）SSE 流打开。（2）Agent 调用 `approvalResolver.resolve(request)`——Promise 挂起，agent 暂停。
   > （3）服务器向浏览器发出 `approval_requested` SSE 事件。（4）浏览器渲染审批 UI。（5）用户批准
   > → 浏览器发送 `POST /api/sessions/:id/approvals`，携带 `{ callId, approved: true }`。（6）服务器
   > 调用 `resolver.settle(callId, decision)` → Promise 解决。（7）Agent runtime 收到批准并执行工具。
   > （8）SSE 流继续 `tool_started`、`tool_completed` 等。

2. 进程重启。浏览器客户端通过发送 turn 恢复 session。会发生什么？
   > Turn 处理器检查 `sessions.get(id)`——返回 `undefined`（Map 在重启时丢失）。它调用
   > `createWebSession(config, id)`，传入已有 session ID。`createWebSession` 调用 `store.getSession(id)`
   > ——在持久 JSONL store 中找到它。它重建全新的 `AgentRuntime`、`WebApprovalResolver` 和
   > `InMemoryRuntimeTraceStore`。Turn 继续，消息历史从 JSONL store 加载。

3. 如果上下文压缩在 Web turn 期间触发，会损失什么？
   > Web turn 处理器不调用 `appendCompactBoundary`。`compact_boundary` 记录不写入 JSONL。下次 turn 时，
   > session store 回放完整的未压缩历史——压缩效果丢失，agent 再次看到完整的（可能很长的）消息历史。
   > 这是相比 CLI adapter 的一个差距。

4. 为什么 `WebApprovalResolver` 使用以 `callId` 为键的 `Map<string, ...>`？
   > 一次 turn 中的多个工具调用可能各自需要审批，可能并发发生。以 `callId` 为键允许每个工具调用的
   > 审批 Promise 独立处理。单个 `{ resolve }` 槽在两个工具同时需要审批时无法工作。

5. Web adapter 相比 CLI 省略了工具集中的什么？
   > Web adapter 不包含 `edit_file`、`append_file`、`search_files`、`update_heartbeat` 或
   > `append_daily_memory`。它有更小的默认工具集——专注于读/写/shell/web，没有 CLI 提供的高级文件
   > 编辑和 memory 工具。这反映了更简单的范围：Web 聊天 UI，而非完整的开发 agent。

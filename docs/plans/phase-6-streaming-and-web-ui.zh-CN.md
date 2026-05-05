# Phase 6 流式输出与 Web UI 计划

状态：完成
日期：2026-05-05

English version: [phase-6-streaming-and-web-ui.md](./phase-6-streaming-and-web-ui.md)

## 进度

状态：完成

已完成提交：

- [x] Part A：流式 ModelProvider — `StreamEvent`、`StreamingModelProvider`、OpenAI SSE 流式、Anthropic 流式、`FakeStreamingProvider`：`d53420d`
- [x] Part B：运行时流式事件 — `token_delta` 事件、`preferStreaming` 选项、AgentRuntime 流式路径：`451cb99`
- [x] Part C：Ink CLI 升级 — `app.tsx` 含 Ink 组件（流式文本、Spinner、审批提示、Todos）、`sendMessage()` 的 `onEvent` 回调、`main()` 中的动态导入：`a8ad560`
- [x] Part D：Web UI — `apps/web` Hono 服务器含 SSE 对话轮次流式、React 前端含流式显示和审批 Modal：`85479a2`

## 1. 目的

Phase 6 让 Agent 具备响应式体验并支持多端访问。

两个用户可见目标：
- 响应逐 Token 流式输出，而非等待完整回答一次性显示。
- 除终端外，还可通过浏览器访问 Agent。

架构目标：
- 证明 CLI 和 Web UI 是同一个 Agent Core 上的两个适配器，而非两套独立实现。

## 2. 范围

本阶段包括：

- `ModelProvider` 接口的流式变体。
- `OpenAICompatibleProvider` 和 `AnthropicProvider` 的流式实现。
- `token_delta` 运行时事件，让适配器显示增量输出。
- CLI 渲染从纯 stdout 升级到 Ink（基于 React 的终端 UI）。
- 新建 `apps/web` 包：Hono API 服务器和 React 前端。
- 服务器到浏览器的 SSE 流式传输。
- 包含流式、工具进度和审批提示的基础聊天界面。

本阶段不包括：

- 上下文压缩。
- 多 Agent 派生。
- 桌面应用。
- 认证/多用户。
- 超出基本事件列表的 Trace 可视化面板。
- 插件市场。

## 3. Part A：流式 ModelProvider

### 目标

让 Provider 在 Token 到达时立即发出，而非等待完整响应。

### `packages/models/src/index.ts` 新增接口

```ts
export type StreamEvent =
  | { type: "token_delta"; delta: string }
  | { type: "tool_calls"; calls: ModelToolCall[]; usage?: ModelUsage }
  | { type: "message_done"; content: string; usage?: ModelUsage }
  | { type: "error"; category: ModelErrorCategory; message: string; recoverable: boolean };

export interface StreamingModelProvider extends ModelProvider {
  generateStream(input: ModelInput): AsyncIterable<StreamEvent>;
}

export function isStreamingProvider(provider: ModelProvider): provider is StreamingModelProvider {
  return "generateStream" in provider && typeof (provider as { generateStream: unknown }).generateStream === "function";
}
```

### Provider 实现

`OpenAICompatibleProvider.generateStream()`：
- 请求体中使用 `stream: true`。
- 通过 `response.body` 读取 SSE 数据块，解析 `data:` 行。
- 对每个 `delta.content` 字段发出 `token_delta`。
- 累积工具调用数据块；完成时发出 `tool_calls`。
- 发出带有最终内容和 usage 的 `message_done`。

`AnthropicProvider.generateStream()`：
- 使用 Anthropic SDK 流式接口（`stream: true` 或 `messages.stream()`）。
- 将 `content_block_delta` 事件转换为 `token_delta`。
- 将 `message_delta` stop 事件转换为 `message_done` 或 `tool_calls`。

`FakeStreamingProvider`：
- 同时实现 `ModelProvider` 和 `StreamingModelProvider`。
- 接受排队的 Token 字符串并以可配置延迟发出。
- 用于 CLI 和 Web UI 集成测试。

### 测试

- 单元测试：通过 Fake HTTP 响应/可注入客户端测试每个 Provider 的流式路径。
- 验证 `token_delta` 事件先于 `message_done` 到达。
- 验证 `tool_calls` 事件格式与非流式格式一致。
- 验证 HTTP 失败和解析失败时的 `error` 事件。

## 4. Part B：运行时流式事件

### 目标

让 AgentRuntime 将流式 Token 增量转发为一等运行时事件，使适配器无需了解具体 Provider 即可显示增量输出。

### 新运行时事件类型

```ts
export interface TokenDeltaEvent extends RuntimeEventBase {
  type: "token_delta";
  delta: string;
}
```

在 `packages/core/src/index.ts` 的 `runtimeEventTypes` 中添加 `token_delta`。

### AgentRuntime 流式路径

当运行时检测到配置的 Provider 实现了 `StreamingModelProvider` 时：

1. 调用 `provider.generateStream(input)` 而非 `provider.generate(input)`。
2. 对每个类型为 `token_delta` 的 `StreamEvent` 发出 `token_delta` 运行时事件。
3. 持续累积文本内容直到 `message_done` 到达。
4. `tool_calls` 和 `error` 事件与非流式路径处理方式相同。
5. 直到 `message_done` 或 `tool_calls` 到达前不发出 `model_request_completed`。

若 Provider 未实现 `StreamingModelProvider`，运行时回退到原有的 `generate()` 调用。

### 设计约束

Agent Core 不改变决策逻辑。`token_delta` 路径是交付细节——在模型发出完成信号前不会派发任何工具调用。

### 测试

- 测试 `token_delta` 事件按顺序发出。
- 测试非流式 Provider 路径不受影响。
- 测试工具调用和错误在流式路径中正常工作。
- 在 Core 测试中使用 `FakeStreamingProvider`。

## 5. Part C：Ink CLI 升级

### 目标

将当前纯 stdout CLI 替换为基于 Ink 的渲染层，支持实时流式输出、工具进度指示器和更丰富的审批提示。

### 为什么选择 Ink

当前 CLI 使用 `process.stdout.write` 加换行符。这种方式适用于非流式逐行输出，但无法：

- 随 Token 到达实时更新同一终端区域。
- 在工具执行期间显示 Spinner 或进度指示器。
- 渲染包含风险说明和内联提示的审批块。
- 就地重新渲染任务进度。

Ink（React for terminals）通过就地重新渲染组件解决了上述所有问题，与 OpenClaw 采用的方案完全一致。

### 架构

测试边界（`runCli()`、`CliChatSession`）保持不变。Ink 作为真实终端的渲染路径：

```
main() — 使用 Ink App 组件
  └─ ChatApp — Ink 根组件
       ├─ ChatHistory — 历史对话
       ├─ CurrentTurn — 当前流式对话
       │    ├─ StreamingText — 实时 Token 增量显示
       │    └─ ToolProgress — 工具执行期间的 Spinner
       ├─ ApprovalPrompt — 运行时发出 approval_requested 时显示
       └─ StatusLine — 模型、模式、会话信息
```

`CliChatSession` 作为无渲染的状态管理器保持不变。Ink 组件调用 `session.sendMessage()` 并响应式地消费事件流。

### 关键 Ink 组件

`StreamingText`：接受 `token_delta` 事件的异步可迭代对象，逐字符渲染文本。未完成时显示光标。

`ToolProgress`：在 `tool_started` 和 `tool_completed` 事件之间显示。展示工具名称和带 Spinner 的耗时。

`ApprovalPrompt`：替代 readline 提示。将工具名称、风险级别、原因和三个选项（y/n/details）渲染为可交互块，通过 Ink 的 `useInput` Hook 处理键盘输入。

`TodosPanel`：`todos_updated` 触发时就地更新，使用状态图标表示 pending/in_progress/completed。

### 可测试性

- `runCli()` 和 `CliChatSession` 保持可注入，不导入 Ink。
- CLI 入口点 `main()` 使用 Ink 组件。
- Ink 自身的 `@ink-testing-library/react` 可独立测试 Ink 组件。
- 集成测试继续直接使用 `CliChatSession.sendMessage()`。

### 依赖

- `ink` — 基于 React 的终端渲染器
- `react` — Ink 必需依赖
- `@types/react` — TypeScript 支持

### 测试

- 使用 `@ink-testing-library/react` 对每个 Ink 组件进行单元测试。
- 验证流式文本增量渲染。
- 验证审批提示接受 `y`/`n`/`d` 按键。
- 验证 Todos 面板在 todos_updated 事件时更新。
- 通过 `CliChatSession` 的现有集成测试保持不变。

## 6. Part D：Web UI

### 目标

提供浏览器端界面，用户可以聊天、查看流式响应、审批工具操作、查看最近 Trace 事件——使用与 CLI 相同的 Agent Core。

### 技术栈

- **后端**：Hono — 轻量级 TypeScript 原生 HTTP 框架，运行于 Node.js，样板代码少。
- **前端**：React + Vite — 快速 HMR，熟悉的技术栈。
- **流式**：Server-Sent Events (SSE) — 比 WebSocket 更简单，适用于服务端到客户端的单向流式传输。
- **端口**：默认 `3120`。

### 新应用：`apps/web`

```
apps/web/
  src/
    server.ts       — Hono 应用：API 路由、SSE 流式、静态文件服务
    client/
      main.tsx      — React 入口
      App.tsx        — 根组件
      components/
        ChatView.tsx
        MessageList.tsx
        StreamingMessage.tsx
        ApprovalModal.tsx
        TracePanel.tsx
  public/
    index.html
  package.json
  tsconfig.json
  vite.config.ts
```

### API 接口

```
POST   /api/sessions                     创建会话 → { sessionId }
GET    /api/sessions                     列出会话 → { sessions[] }
GET    /api/sessions/:id/messages        获取消息 → { messages[] }
GET    /api/sessions/:id/events          对话轮次的 SSE 事件流
POST   /api/sessions/:id/turns           发起新对话轮次 → 200，通过 SSE 流式传输
POST   /api/sessions/:id/approvals       处理审批请求 → { approved, reason }
```

### SSE 流式

前端调用 `POST /api/sessions/:id/turns` 时，服务端：

1. 创建 SSE 响应（`Content-Type: text/event-stream`）。
2. 对消息启动 `runtime.runTurn()`。
3. 将每个 `RuntimeEvent` 作为 SSE 事件流式传输。
4. `run_completed` 或 `run_failed` 触发时关闭 SSE 流。

前端通过 `EventSource` 读取事件，增量更新 React 状态。

### Web UI 审批流程

服务端遇到 `approval_requested` 时：

1. 挂起对话轮次，保持 SSE 连接。
2. 向客户端发送 `approval_requested` SSE 事件。
3. 渲染包含工具名称、风险和原因的 `<ApprovalModal>`。
4. 用户点击批准/拒绝。
5. 前端 POST 到 `/api/sessions/:id/approvals`。
6. 服务端解析审批 Promise；对话轮次继续。
7. SSE 流恢复。

Web 服务器的 `ApprovalResolver` 使用一个待决的 Promise，当审批 POST 到达时被解析。

### React 前端

MVP UI 组件：
- `ChatView` — 包含消息列表和输入框的主布局。
- `MessageList` — 渲染历史消息和当前流式消息。
- `StreamingMessage` — 显示带光标的累积文本。
- `ApprovalModal` — 审批请求时显示的遮罩层。
- `TracePanel` — 最近 Trace 事件的可折叠列表。

无认证、无多用户、服务器重启后无持久会话（Phase 6 服务端使用 `InMemorySessionStore`；持久化存储在 Phase 7+ 添加）。

### 测试

- 使用 Hono 测试工具的 API 路由测试。
- SSE 事件格式测试。
- 审批 Resolver Promise 流程测试。
- 使用 `@testing-library/react` 的 React 组件测试。
- E2E 冒烟测试：发送消息，验证响应显示。

## 7. 提交顺序

每个提交必须同时包含代码 + 文档 + 文件头更新。

1. `feat(models): add streaming interface and provider implementations`
   - models 包中的 `StreamEvent`、`StreamingModelProvider`、`isStreamingProvider`
   - `OpenAICompatibleProvider` 和 `AnthropicProvider` 的 `generateStream()`
   - `FakeStreamingProvider`
   - 测试
   - 更新 `packages/models/README.md`、`AGENTS.md`、源文件头

2. `feat(core): add token_delta runtime event and streaming path`
   - `token_delta` 事件类型
   - `AgentRuntime` 中的流式检测和转发
   - 测试
   - 更新 `packages/core/README.md`、`AGENTS.md`、源文件头

3. `feat(cli): upgrade to Ink rendering`
   - 添加 Ink 依赖
   - Ink 组件：`StreamingText`、`ToolProgress`、`ApprovalPrompt`、`TodosPanel`、`StatusLine`
   - Ink `App` 根组件和更新的 `main()`
   - `CliChatSession` 不变；Ink 层叠加其上
   - 测试
   - 更新 `apps/cli/README.md`、`AGENTS.md`、源文件头

4. `feat(web): add web app with Hono server and React frontend`
   - `apps/web` 包脚手架
   - Hono 服务器含 API 路由和 SSE
   - React + Vite 前端
   - HTTP 审批流的 `ApprovalResolver`
   - 测试
   - 更新根 `README.md`、`docs/roadmap/overview.md`
   - 新建 `packages/web/README.md`、`AGENTS.md`

## 8. 非目标

- 上下文压缩或 Token 预算管理。
- 多 Agent 派生。
- 桌面应用打包。
- 认证或多用户会话。
- 超出基本事件列表的 Trace 可视化面板。
- OpenClaw `sessions_spawn` 等价实现。
- 超出上下文长度的处理。

## 9. 验收标准

- 模型响应在 CLI 终端通过 Ink 逐 Token 流式显示。
- CLI 使用 Ink 组件处理流式输出、工具进度和审批提示。
- `runCli()` 和 `CliChatSession` 测试在无 Ink 路径下继续通过。
- `http://localhost:3120` 的 Web UI 可与真实或 Fake Provider 聊天。
- Web UI 随 Token 到达实时显示流式内容。
- Web UI 在需要审批时显示审批提示。
- Web UI 和 CLI 均使用相同的 `AgentRuntime`、`SessionStore` 和事件类型。
- 所有包的 `pnpm run check` 通过。

## 10. 相关文档

- [路线图](../roadmap/overview.md)
- [UI 适配器](../architecture/ui-adapters.zh-CN.md)
- [Trace 可视化](../architecture/trace-visualization.zh-CN.md)
- [模型 Provider](../architecture/model-provider.zh-CN.md)
- [CLI 适配器](../architecture/cli-adapter.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)

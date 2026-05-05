# Adapters

状态：草案
日期：2026-05-05

English version: [adapters.md](./adapters.md)

## 1. 目的

Adapter 将用户界面与 Agent Core 连接，但不拥有 agent 行为。

ArvinClaw 暴露一个 `AgentRuntime` 和多个界面：终端（CLI）、浏览器（Web UI），以及未来的桌面、消息和后台任务。Adapter 层使这些界面可以互换，而不重复 agent 逻辑。

## 2. Adapter 边界规则

Agent Core 拥有行为。Adapters 拥有交互。

正确的 adapter：

- 收集用户输入（readline、HTTP POST、WebSocket）
- 渲染 agent 输出（stdout、SSE、WebSocket push）
- 呈现 approval prompts（readline confirm、modal overlay）
- 通过 `ApprovalResolver` 转发 approval 决策
- 管理界面生命周期（进程、HTTP 连接、窗口）

正确的 adapter 不：

- 组装 prompts 或 context
- 定义或执行 tools
- 应用 permission policy
- 决定 session 或 trace 持久化策略（接收已配置好的 store）
- 直接配置 model providers（接收已配置好的 provider）

## 3. AdapterCapabilities

每个 adapter 声明它支持哪些交互模式。

```ts
export interface AdapterCapabilities {
  streaming: boolean;       // 能否显示 token_delta events
  approvalPrompts: boolean; // 能否展示交互式 approval UI
  background: boolean;      // 能否在没有活跃用户连接时运行
}
```

规范常量：

| 常量 | streaming | approvalPrompts | background |
| --- | --- | --- | --- |
| `CLI_CAPABILITIES` | true | true | false |
| `WEB_CAPABILITIES` | true | true | false |
| `BACKGROUND_CAPABILITIES` | false | false | true |

这些声明有两个用途：

1. **文档化**：使 capability 契约明确，而非隐式。
2. **运行时路由**（Phase 8+）：gateway 可以将任务路由到支持所需 capabilities 的 adapters。

## 4. AdapterStorageType

```ts
export type AdapterStorageType = "in-memory" | "jsonl" | "sqlite";
```

Adapters 不在运行时选择存储策略 — server 或 CLI entrypoint 配置存储并将 `SessionStore` 传递给 adapter。该类型用于配置和文档中。

## 5. CLI Adapter

位置：`apps/cli`

CLI adapter 使用 readline（或 Ink 用于实时 streaming）收集输入并写入输出。它使用 `~/.arvinclaw/sessions` 处的 `JsonlSessionStore` 持久化 session history。支持 streaming 输出和交互式 approval prompts。

Capabilities：`CLI_CAPABILITIES`

## 6. Web Adapter

位置：`apps/web`

Web adapter 通过 HTTP 和 SSE 暴露 Agent Core。它使用共享的 `JsonlSessionStore`，使 sessions 在服务器重启后持久存在，并对 CLI 可见。通过 SSE 支持 streaming，通过 modal overlay 支持 approval prompts。

Capabilities：`WEB_CAPABILITIES`

## 7. 未来 Adapters

Phase 8 将引入在没有活跃用户连接时运行的 background adapter。Background tasks 不能显示 streaming 输出或 approval prompts — 使用 `BACKGROUND_CAPABILITIES`。

Phase 10 将引入 gateway 层，根据 capabilities 和任务需求将任务路由到 adapters。Gateway 是多个 adapters 汇聚为单一 agent network 的节点。

## 8. 共享 Session 目录

CLI 和 Web 都使用 `packages/config` 中的 `resolveSessionsDirectory(config, env)` 计算 sessions 目录路径。这确保它们指向同一目录，在一个界面创建的 sessions 在另一个界面也可见。

## 9. 这不是什么

这不是 plugin 系统。Adapters 是同一仓库中维护的第一方界面。Third-party adapters 是 Phase 9+ 的关注点。

这不是传输协议。Adapters 不是远程节点。Gateway（Phase 10）处理多节点通信。

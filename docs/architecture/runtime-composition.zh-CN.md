# Runtime Composition

状态：活跃
日期：2026-05-11

English version: [runtime-composition.md](./runtime-composition.md)

## 1. 目的

Runtime composition 定义 Vole 应用入口如何组装 configuration、model providers、tools、permissions、context、sessions、trace 和 Agent Core。

核心规则：

应用启动负责组装依赖。Agent Core 负责运行行为。

## 2. 为什么这个模块存在

如果没有明确的 composition layer，setup logic 很容易泄漏到错误位置：

- CLI 开始读取 model-specific environment variables。
- Agent Core 开始构造 providers。
- Tools 开始直接读取 global config。
- Permission logic 开始混入 terminal prompts。
- Session storage 被耦合到某一个 adapter。

Runtime composition 防止这种漂移。

## 3. MVP 组装流程

Phase 0 和 Phase 1 应使用简单的单进程组装流程：

```text
CLI startup
  -> Load and validate configuration
  -> Resolve workspace
  -> Create trace sink
  -> Create session store
  -> Create model provider
  -> Create tool registry
  -> Create permission policy
  -> Create context assembler
  -> Create agent runtime
  -> Start CLI adapter loop
```

具体 factory 名称可以在实现阶段变化，但依赖方向应保持稳定。

## 4. 组装职责

CLI 入口可以拥有应用启动，但应该把 setup details 委托给 package APIs。

| 关注点 | 归属 | 说明 |
| --- | --- | --- |
| Config loading | `packages/config` | CLI 调用 loader，但不自己解析 files |
| Provider creation | Application composition | 使用 `packages/models` factories |
| Tool registration | Application composition | 使用 `packages/tools` registry |
| Permission policy | `packages/permissions` | CLI 只渲染 approval prompts |
| Context assembly | `packages/context` | CLI 永远不直接构建 prompts |
| Session store | `packages/sessions` | CLI 不直接写 session files |
| Trace sink | `packages/sessions` 或 `packages/core` boundary | Trace events 是结构化的 |
| Agent runtime | `packages/core` | 接收已配置依赖 |

## 5. 依赖方向

依赖向内流动。Adapter 负责组装；core 包保持与入口无关。

```text
apps/cli ──────────────────────────────────────────┐
apps/web ──────────────────────────────────────────┤
         │                                          │
         ├──▶ @vole/core ◀── @vole/scheduler
         │         │
         │         ├──▶ @vole/context ──▶ @vole/models
         │         ├──▶ @vole/models
         │         ├──▶ @vole/permissions
         │         └──▶ @vole/tools
         │
         ├──▶ @vole/config
         ├──▶ @vole/sessions
         ├──▶ @vole/gateway ──▶ @vole/adapters
         ├──▶ @vole/adapters
         ├──▶ @vole/skills
         ├──▶ @vole/taskflow
         └──▶ @vole/scheduler ──▶ @vole/core（仅类型）
```

`packages/core` 依赖 `context`、`models`、`permissions`、`tools` 的接口和领域类型。它不得依赖任何 adapter、config、sessions、gateway 或 scheduler 代码。

## 6. Effective Configuration

Composition 从加载 effective configuration 开始。

Effective configuration 应决定：

- Provider type
- Provider settings
- Workspace root
- Default autonomy mode
- Enabled tool categories
- Trace verbosity
- Session storage location

Secret values 只应被解析给需要它们的组件。

## 7. Workspace Resolution

Workspace root 应在创建 tools 和 context 前解析。

Resolved workspace 应传递给：

- File tools
- Shell tool
- Context assembler
- Workspace file loader
- Permission policy
- Trace metadata

这能让 workspace safety checks 保持一致。

## 8. Provider Creation

Composition layer 基于 configuration 创建 model provider。

Agent Core 应接收 ready `ModelProvider`。

Agent Core 不应该知道：

- Config files 存在哪里
- 哪个 environment variable 包含 API key
- 安装了哪个 vendor SDK
- Provider-specific clients 如何构造

## 9. Tools 和 Permissions

Tools 和 permissions 分开组装。

Tools 描述可能的动作。Permissions 决定请求动作是否可以运行。

Runtime 应把两者接入 Agent Core：

```text
AgentRuntime
  uses ToolRegistry
  uses PermissionPolicy
  emits ApprovalRequest when needed
```

CLI adapter 处理用户 approval UX，然后把 decision 发回 runtime。

## 10. Context Assembly

Context assembler 应使用安全依赖创建：

- Effective non-secret config metadata
- Skill index
- Tool definitions
- Session resume source
- Workspace file loader when enabled
- Redaction utilities

CLI 只应展示 context package 生成的 context reports。

## 11. Sessions 和 Trace

Runtime 应通过 session 和 trace interfaces 持久化结构化记录。

Phase 1 可以使用 in-memory 或轻量本地存储。形状仍应支持：

- Session ID
- Run ID
- User turn ID
- Trace event IDs
- Ordered writes
- Future replay

## 12. 错误处理

Startup errors 应在 adapter boundary 捕获，并清晰渲染。

示例：

- Invalid config
- Missing API key
- Unsupported provider
- Workspace path does not exist
- Session store cannot initialize

Agent run 内部的 errors 应尽可能进入 trace。

## 13. 未来 Adapters

同一 composition 概念应支持：

- Web UI server
- Desktop app
- Messaging adapter
- Background runner

Adapters 可以在渲染 events、收集 approvals 和处理 cancellation 方面不同。它们不应该重新定义 Agent Core behavior。

## 14. 测试要求

Runtime composition 需要 integration tests。

必需测试领域：

- Config loader 在 provider creation 前被调用。
- Agent Core 接收 configured dependencies。
- CLI 不直接 assemble prompts。
- 当 shared factory 存在时，CLI 不直接实例化 provider SDKs。
- Missing secret 产生 adapter-friendly startup error。
- Invalid workspace path 安全停止启动。
- Fake model、fake tools、fake permissions 和 fake sessions 可以组装出 working runtime。

## 15. 验收标准

Runtime composition 成功标准：

- CLI startup path 可以创建所有 MVP dependencies。
- Agent Core 不读取 config files 或 environment variables。
- Prompt assembly 保持在 `packages/context` 内。
- Tool execution 仍然经过 permissions。
- Session 和 trace persistence 通过 interfaces 访问。
- 未来 adapters 可以复用同一 composition pattern。

## 16. createAgent() 工厂函数

`createAgent()` 是 runtime composition 的首选公共 API。它封装了 `new AgentRuntime()`，提供合理默认值，调用方无需显式构造每个依赖：

```ts
import { createAgent } from "@vole/core";

// 最小可用 agent
const agent = createAgent({ model: provider });

// 完整组合
const agent = createAgent({
  model: provider,
  systemInstruction: AGENT_SYSTEM_INSTRUCTION,
  tools: allTools,
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: cliApprovalResolver,
  context: new DefaultContextAssembler({ workspaceFiles: [...] }),
  compaction: { maxTokens: 60_000 },
});
```

工厂函数不包含 sessions——session 历史以 `recentMessages` 的形式传入每次 `runTurn()` 调用，调用方从 `turn_complete` 事件中取出新消息进行持久化。这保持了 session 归属在 adapter 边界上。

直接 `new AgentRuntime(dependencies)` 构造方式对需要精细控制依赖的场景仍然有效。

层叠模型和 null/minimal 实现详见 [Progressive Composition](./progressive-composition.zh-CN.md)。

## 17. 相关文档

- [Project Structure](./project-structure.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [Architecture Contracts](./contracts.zh-CN.md)
- [CLI Adapter](./cli-adapter.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Testing Strategy](./testing-strategy.zh-CN.md)

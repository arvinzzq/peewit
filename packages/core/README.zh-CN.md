# Core Package

English version: [README.md](./README.md)

## 架构概述

`@arvinclaw/core` 是 Agent 运行时编排层，处于整个包依赖图的中心。它消费所有其他领域包，并向上方的 Adapter（CLI、Web）暴露统一的运行时接口。

```
CLI / Web adapter
        │
        ▼
   AgentRuntime          ← @arvinclaw/core
  ├─ ContextAssembler    (@arvinclaw/context)
  ├─ ModelProvider       (@arvinclaw/models)
  ├─ PermissionPolicy    (@arvinclaw/permissions)
  └─ ExecutableTool[]    (@arvinclaw/tools)
```

Core 必须保持 **adapter 无关**（不含终端渲染或 HTTP 代码）和 **vendor 无关**（不导入 Anthropic 或 OpenAI SDK）。Adapter 调用 `AgentRuntime.runTurn()` 并消费其异步生成器产生的 `RuntimeEvent` 对象。

## 核心概念

### RuntimeEvent 事件系统

Agent 在一次 turn 中的每个可观测动作都会发出一个类型化的 `RuntimeEvent`，共 17 种事件类型，构成严格的生命周期状态机：

```
run_started
  → context_assembled
  → model_request_started
    → token_delta*          （仅在 preferStreaming 下）
  → model_request_completed
    → tool_call_requested
    → tool_call_permission_evaluated
      → [approval_requested → approval_resolved]   （decision = "ask" 时）
    → tool_started → tool_completed | tool_failed
  → todos_updated            （本步骤调用了 update_todos 时）
  → [planning_stall_detected → ...]  （检测到停滞时）
  → assistant_message_created
run_completed | run_failed
```

`isTerminalRuntimeEvent(event)` 对 `run_completed` 和 `run_failed` 返回 `true`，Adapter 以此作为停止迭代生成器的信号。`InMemoryRuntimeTraceStore` 提供默认的进程内存储，Adapter 可注入替代实现。

### AgentRuntime — 多步骤循环

`AgentRuntime.runTurn(input)` 是一个 `AsyncIterable<RuntimeEvent>`，每次调用对应一个用户 turn。循环流程：

1. 获取 `SessionMutex`（为同一 sessionId 的并发调用串行化）。
2. 调用 `beforeTurn` hook（错误被静默隔离）。
3. 调用 `ContextAssembler.assemble()` 构建 `ModelInput`。
4. 进入 `while (steps < maxSteps)` 循环：
   - 若配置了 `compaction` 且消息数超过 `maxMessages`，可选地压缩消息历史。
   - 调用 `ModelProvider.generate()` 或 `generateStream()`（流式路径）。
   - 若输出为 `type: "message"`：检测规划停滞，发出 `assistant_message_created` + `run_completed` 后退出。
   - 若输出为 `type: "tool_calls"`：逐个通过 `PermissionPolicy` 评估，执行已批准的工具，追加结果消息，重复循环。
5. 达到 `maxSteps` 后发出 `run_failed`。
6. 在 `finally` 块中始终释放 `SessionMutex`。
7. 用收集到的完整事件列表调用 `afterTurn` hook（错误被静默隔离）。

### 规划停滞检测

当模型返回看起来像是叙述计划而非实际调用工具的文本时，运行时使用三个启发式正则检测"停滞"：

- `PLAN_PROMISE_RE` — 匹配"I'll"、"let me"、"I'm going to"等短语
- `PLAN_HEADING_RE` — 匹配"Plan:"、"Steps:"、"Here's what I"等标题
- `PLAN_BULLET_RE` — 匹配有序或无序列表

检测到停滞后，运行时发出 `planning_stall_detected` 并注入重试指令。连续停滞达到 `maxPlanningStallRetries` 次后，运行失败。每次模型成功调用工具或产生非停滞消息后，计数器重置。

### SessionMutex

通过 Promise 链队列，对同一 `sessionId` 的并发 `runTurn` 调用进行串行化。不同 session 可并发运行。Map 条目在无等待者时自动清理。

```typescript
const mutex = new SessionMutex();
// 同一 session → 顺序排队
const release1 = await mutex.acquire("sess_A");
const release2 = await mutex.acquire("sess_A");   // 等待 release1
// 不同 session → 并发
const releaseB = await mutex.acquire("sess_B");   // 不等待
```

### AgentHooks

无需子类化的生命周期拦截钩子：

| 钩子 | 触发时机 | 能否中止 |
|---|---|---|
| `beforeTurn(input)` | context 组装前 | 否，错误被隔离 |
| `afterTurn(events)` | run 完成或失败后 | 否，错误被隔离 |
| `beforeToolCall(call)` → `"abort"` | 工具执行前 | 是，返回 `"abort"` 触发 `tool_failed` |
| `afterToolCall(call, result)` | 工具完成后 | 否，错误被隔离 |
| `onCompaction(before, after)` | 消息历史压缩后 | 否，错误被隔离 |

所有钩子错误在非生产环境用 `console.warn` 捕获记录。

### ExecutionContract

两种执行契约影响系统指令和停滞容忍度：

| 契约 | `maxPlanningStallRetries` | 系统指令附加 |
|---|---|---|
| `"default"` | 2 | 无 |
| `"strict-agentic"` | 3 | 附加"立即行动，不要叙述计划，现在调用工具"指令 |

### Subagent 工具

两个 subagent 工具位于 `core`（而非 `tools`），以避免与 `AgentRuntime` 的循环导入：

- **`createSpawnSubagentTool(factory)`** — 同步：将子 `AgentRuntime` 运行至完成，返回助手文本或错误。
- **`createSpawnSubagentAsyncTool(factory, options)`** — 即发即忘：创建 `taskId`，可选记录到 `AsyncTaskStore`，在后台启动子 Agent，立即返回 `{ taskId, status: "queued" }`。

### update_todos（内置工具）

`update_todos` 始终作为第一个工具注册，位于所有用户提供工具之前。调用时更新运行时的 `#currentTodos`。包含 `update_todos` 的工具调用批次完成后，运行时发出带新 todo 列表的 `todos_updated` 事件。

## 实现原理

### 流式路径

当 `preferStreaming = true` 且 Provider 满足 `isStreamingProvider(provider)` 时，运行时调用 `generateStream`，累积 token delta（立即向 Adapter yield `token_delta` 事件），并在流结束时重构 `ModelOutput`。

### 每次工具调用的权限流程

```
工具调用请求
  → permissionPolicy.evaluate({ mode, action })
    → "allow"  → 立即执行
    → "deny"   → 发出 run_failed（硬终止）
    → "ask"    → 发出 approval_requested
                 → approvalResolver.resolve(request)
                   → approved: true  → 执行
                   → approved: false → 发出 run_failed（硬终止）
```

### 工具执行上下文

每个 `ExecutableTool.execute(input, context)` 接收 `ToolExecutionContext`，`workspaceRoot` 设为 `this.#runtime?.workspace ?? process.cwd()`，允许工具相对于配置的工作空间解析路径。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 core 包及对 context、models、permissions、tools 的 workspace 依赖。 |
| `tsconfig.json` | TypeScript 配置 | 使用项目引用构建 core。 |
| `src/index.ts` | 运行时核心 | 所有导出：17 种事件类型及联合类型、`AgentRuntime`、`SessionMutex`、`AgentHooks`、`ExecutionContract`、`InMemoryRuntimeTraceStore`、`RuntimeTraceStore`、`ApprovalResolver`、`SubagentFactory`、`createSpawnSubagentTool`、`createSpawnSubagentAsyncTool`、`AsyncTaskStore`。 |
| `src/index.test.ts` | 运行时测试 | 覆盖所有事件路径、权限策略、审批、hooks、停滞检测、流式、subagent 工具、`SessionMutex` 并发和 `ExecutionContract` 行为的完整测试套件。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

# Core Package

English version: [README.md](./README.md)

## 架构概述

`@vole/core` 是 Agent 运行时编排层，处于整个包依赖图的中心。它消费所有其他领域包，并向上方的 Adapter（CLI、Web）暴露统一的运行时接口。

```
CLI / Web adapter
        │
        ▼
   AgentRuntime          ← @vole/core
  ├─ ContextAssembler    (@vole/context)
  ├─ ModelProvider       (@vole/models)
  ├─ PermissionPolicy    (@vole/permissions)
  └─ ExecutableTool[]    (@vole/tools)
```

Core 必须保持 **adapter 无关**（不含终端渲染或 HTTP 代码）和 **vendor 无关**（不导入 Anthropic 或 OpenAI SDK）。Adapter 调用 `AgentRuntime.runTurn()` 并消费其异步生成器产生的 `RuntimeEvent` 对象。

### createAgent() — 首选入口

`createAgent()` 是构造 agent 的首选方式。它封装了 `new AgentRuntime()`，提供合理默认值，只需指定所需的部分：

```typescript
import { createAgent } from "@vole/core";

// Layer 0 — 裸 loop
const agent = createAgent({ model: provider });

// Layer 1 — 添加 tools
const agent = createAgent({ model: provider, tools: [readFileTool], permissions: new AlwaysAllowPolicy() });

// 完整组合
const agent = createAgent({
  model: provider,
  systemInstruction: "你是 Vole。",
  tools: allTools,
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: cliResolver,
  context: new DefaultContextAssembler({ workspaceFiles: ["AGENTS.md"] }),
  compaction: { maxTokens: 60_000 },
});
```

除 `model` 外所有字段均为可选。Sessions 由调用方管理：向 `runTurn()` 传入 `recentMessages`，并从 `turn_complete` 事件中取出新消息进行持久化。完整层叠模型详见 [Progressive Composition](../../docs/architecture/progressive-composition.zh-CN.md)。

## 核心概念

### RuntimeEvent 事件系统

Agent 在一次 turn 中的每个可观测动作都会发出一个类型化的 `RuntimeEvent`，共 19 种事件类型，构成严格的生命周期状态机：

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
  → turn_complete            （携带本轮所有新消息）
run_completed | run_failed
```

`turn_complete` 仅在成功路径发出，位于 `run_completed` 之前。它携带本轮生成的全部新消息，包括 `user`、`tool_use`、`tool_result` 和最终的 `assistant` 消息。适配器使用此事件将完整工具调用上下文持久化到 session store。

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

当模型返回看起来像是叙述计划而非实际调用工具的文本时，运行时使用与 OpenClaw 对齐的守卫链进行检测。守卫分为两个层次：

**Turn 级守卫（在文本分析之前检查）**

- **`hadRealToolCallThisTurn`**——如果本次 turn 中已有任何非 `update_todos` 工具被调用过，则后续消息是在汇报结果，而非规划。完全跳过停滞检测。对应 OpenClaw 的 `hasNonPlanToolActivity` 检查：已经做了真实工作的模型不可能在停滞。

**文本级守卫（对消息内容进行分析）**

1. **长度守卫**（`PLAN_MAX_CHARS = 700`）——超过 700 字符的回复几乎肯定是结果汇报，而非计划。
2. **代码块守卫**——包含 ` ``` ` 的回复永远不是计划停滞。
3. **`PLAN_COMPLETION_RE`**——若回复包含完成语言（`done`、`finished`、`implemented`、`found`、`here's what`、`verified`、`ran` 等），说明模型已采取行动，永远不是停滞。
4. **`PLAN_PROMISE_RE`**——明确的未来行动承诺语言（"I'll"、"let me"、"I'm going to"等）。
5. **`hasStructuredPlanFormat`**——结构化计划 = 明确的计划标题（`Plan:`、`Steps:`、`Next steps:`）+ 承诺语言，_或_ ≥2 条 bullet/有序列表项 + 承诺语言。结构化格式单独即可作为停滞信号。
6. **`PLAN_ACTION_VERB_RE`**——对于非结构化（无标题/列表）的消息，除承诺语言外还需要具体的动作动词（`read`、`search`、`implement`、`investigate` 等）——防止"let me think about this"这类模糊填充语触发检测。

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

`compaction_triggered` 事件现在包含 `summary: string` 字段。Phase 2 成功时该字段包含从压缩后消息中提取的摘要文本；适配器使用它调用 session store 的 `appendCompactBoundary()`。

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
| `src/index.ts` | 运行时核心 | 所有导出：`createAgent`、`CreateAgentOptions`、19 种事件类型及联合类型、`AgentRuntime`、`AgentRuntimeDependencies`、`SessionMutex`、`AgentHooks`、`ExecutionContract`、`InMemoryRuntimeTraceStore`、`RuntimeTraceStore`、`ApprovalResolver`、`SubagentFactory`、`createSpawnSubagentTool`、`createSpawnSubagentAsyncTool`、`AsyncTaskStore`。 |
| `src/index.test.ts` | 运行时测试 | 覆盖所有事件路径、权限策略、审批、hooks、停滞检测、流式、subagent 工具、`SessionMutex` 并发和 `ExecutionContract` 行为的完整测试套件。 |
| `src/create-agent.test.ts` | 渐进式组合测试 | 层隔离测试：Layer 0（裸 loop）、Layer 1（tool dispatch）、Layer 2（权限评估）、Layer 3（session 消息）、Layer 4（context assembler）、多层组合。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

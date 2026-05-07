# 模块 11：@vole/core

Status: Complete
Date: 2026-05-07

English version: `02-core.md`（与本文件并列）

相关源码：`packages/core/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md)阶段二的产出。涵盖 `@vole/core`——整个系统的中心。
在阅读其他任何模块文档之前，先读这篇。

**阅读前**：先建立阶段一的心智模型（[01-concepts.zh-CN.md](./01-concepts.zh-CN.md)）。
然后阅读以下一手资料：

1. `docs/architecture/agent-loop.md` — 第 15 节（接口定义和事件类型）
2. `packages/core/src/index.ts` — 从导出的 `runtimeEventTypes` 数组开始，然后
   `AgentRuntimeDependencies`，最后 `runTurn`
3. `packages/core/src/index.test.ts` — 先读测试名称再读实现；`describe` / `test`
   的标签描述了这个模块保证的每一个行为

**核心问题**：阅读源码时回答这些问题：
- 17 个 `RuntimeEventType` 值是什么，正常运行时以什么顺序出现？
- 为什么 `runTurn` 返回 `AsyncGenerator<RuntimeEvent>` 而不是 `Promise<RuntimeEvent[]>`？
- 权限评估在循环的哪个确切位置发生？
- 为什么 `ContextAssembler` 是注入的而不是在 `AgentRuntime` 内部创建的？
- 什么触发 `planning_stall_detected`，触发后发生什么？

**检查点**：当你能从 `runTurn(input)` 调用追踪到 `run_completed`——说出每个发射的事件
和循环经过的每个决策点——说明你已经掌握了这个模块。

## 1. 这个模块做什么

`@vole/core` 运行 agent turn 循环。它接收用户消息，协调 context 组装、模型推理、权限评估、
工具执行——在一个循环中——并在每一步以事件流的形式向外发射可观察事件。

它是整个系统的中心。其他所有包要么为这个循环服务，要么刻意不碰它。

## 2. 为什么它存在

如果没有专用的运行时循环，每个适配器（CLI、Web、桌面端）都必须自己实现模型调用、工具派发、
权限逻辑。那意味着重复代码和不一致的安全保证。

`@vole/core` 是"agent turn 做什么"的唯一共享实现。适配器消费它的事件流，不需要重新实现
循环。

## 3. 公开接口

```ts
class AgentRuntime {
  constructor(dependencies: AgentRuntimeDependencies)
  runTurn(input: AgentRuntimeInput): AsyncIterable<RuntimeEvent>
}

interface AgentRuntimeDependencies {
  contextAssembler: ContextAssembler   // 必须 — 每次模型调用前组装 context
  modelProvider: ModelProvider         // 必须 — 厂商无关的模型接口
  systemInstruction: string            // 必须 — 基础系统提示文本
  permissionPolicy?: PermissionPolicy  // 可选 — 默认使用 DefaultPermissionPolicy
  approvalResolver?: ApprovalResolver  // 可选 — 处理 "ask" 决策时与用户的交互
  tools?: ExecutableTool[]             // 可选 — 注册的工具列表
  maxSteps?: number                    // 可选 — 默认 12
  executionContract?: ExecutionContract // "default" | "strict-agentic"
  sessionMutex?: SessionMutex          // 可选 — 防止同一会话的并发运行
  hooks?: AgentHooks                   // 可选 — beforeTurn, afterTurn, beforeToolCall 等
}

interface AgentRuntimeInput {
  message: string
  sessionId?: string
  recentMessages?: ModelMessage[]
}
```

关键点：`AgentRuntime` 的所有依赖从外部注入，自己只创建内部的 `update_todos` 工具。这使得
它可以完全用 fake 进行测试。

## 4. 实现流程

`runTurn` 是一个 `async *` generator，yield `RuntimeEvent` 值。调用方用 `for await` 消费：

```ts
for await (const event of runtime.runTurn(input)) {
  // 将每个事件流式传递给适配器
}
```

每次调用经过以下几个阶段：

**阶段一 — 获取 mutex 锁（约第 390 行）**
如果配置了 `sessionMutex`，`runTurn` 在做任何工作之前先获取会话锁。这确保每个会话同时
只有一次 turn 在运行。锁在 `finally` 块释放，即使 turn 中途失败也不例外。

**阶段二 — 启动（约第 411–429 行）**
yield `run_started`。调用 `contextAssembler.assemble()`，传入系统指令、技能索引、工具摘要、
权限指南、用户消息。yield `context_assembled`。

**阶段三 — while 循环（约第 442 行）**
最多运行 `maxSteps`（默认 12）次迭代。每次迭代：

1. 如果配置了 compaction，对消息历史进行压缩
2. yield `model_request_started`
3. 调用模型（根据 `preferStreaming` 选择流式或非流式）
4. yield `model_request_completed`
5. 根据输出类型分支：

**分支 A — 模型返回纯文字消息**

在接受消息作为最终答案之前，运行时检测规划停顿。`isPlanningOnly()` 扫描承诺语言
（"I'll…"、"let me…"）、计划标题（"Plan:"、"Steps:"）和列表项。700 字符长度上限
和完成语言检查（`done`、`fixed`、`found`）防止误判。

如果检测到停顿：yield `planning_stall_detected`，向消息添加重试指令，继续循环。
如果停顿次数超过 `maxPlanningStallRetries`：yield `run_failed`，return。

如果没有停顿：yield `assistant_message_created` 和 `run_completed`，return。

**分支 B — 模型返回工具调用**

对批次中的每个调用：

1. 在注册表中查找工具。如果找不到：yield `tool_failed`，将错误文本推入工具结果，
   **continue**（模型在下一步能看到这个错误）。
2. 评估权限，yield `tool_call_permission_evaluated`。
3. 如果 `deny`：设置 `hardTerminate = true`，break 工具循环。
4. 如果 `ask`：yield `approval_requested`，调用 `approvalResolver.resolve()`，yield
   `approval_resolved`。如果用户拒绝：设置 `hardTerminate = true`，break。
5. 运行 `beforeToolCall` hook。如果返回 `"abort"`：yield `tool_failed`，推入错误，continue。
6. yield `tool_started`。执行 `tool.execute()`。成功：yield `tool_completed`，推入结果。
   异常：yield `tool_failed`，推入错误文本，**continue**（模型在下一步能看到）。
7. 运行 `afterToolCall` hook。

工具循环结束后：如果 `hardTerminate`，yield `run_failed` 并 return。否则把所有工具结果
追加到 messages，回到 while 循环第 3 步。

**阶段四 — 步数上限**
如果 while 循环耗尽 `maxSteps`，yield 步数上限的 `run_failed`。

## 5. OpenClaw 对照

| OpenClaw | Vole | 备注 |
|---|---|---|
| `pi-embedded-runner.ts` | `AgentRuntime.runTurn` | 核心循环结构 |
| `incomplete-turn.ts` | `isPlanningOnly()` | 停顿检测的正则模式 |
| `lanes.ts`（会话队列） | `SessionMutex` | 每会话串行化 turn |
| `update_plan` tool | `update_todos`（内置） | 全量替换的 todo 列表，模型调用 |
| `agent-command.ts` | `AgentRuntimeDependencies` 注入 | 入口点的依赖注入 |

`executionContract: "strict-agentic"` 对应 OpenClaw 的 strict-agentic 模式：向系统提示
追加指令（"立即行动，不要叙述计划"），并将规划停顿的重试预算从 2 增加到 3。

差异：OpenClaw 的 `update_plan` 工具默认禁用，按模型 opt-in。Vole 的 `update_todos`
始终注册，始终可用。

## 6. 关键设计决策

**AsyncGenerator 而非 Promise**

`runTurn` 返回 `AsyncIterable<RuntimeEvent>` 而不是 `Promise<RuntimeEvent[]>`。这让
适配器在循环运行时就能观察它——流式输出 token、显示权限提示、展示工具进度——而不必等待
整个 turn 完成。

**`deny` 是硬停止；工具错误不是**

`deny` 权限决策立即触发 `run_failed`（模型永远看不到它）。工具错误——找不到工具、执行
异常——作为工具结果消息返回给模型。模型然后可以决定下一步怎么做。

这个不对称是刻意设计的：`deny` 意味着人或策略说了"停止"；工具错误是环境性的，模型
可能有合理的恢复选项。

**`update_todos` 始终注册**

`update_todos` 工具在构造函数中创建，合并到工具 map 中，先于任何用户提供的工具。
无法禁用它。这确保每个 `AgentRuntime` 实例都能接收并暴露轮内进度。

**`hadRealToolCallThisTurn` 守卫**

一旦任何非 `update_todos` 的工具执行过，后续的纯文字响应永远不会被标记为规划停顿。
这防止了在模型完成真实工作后写摘要时，停顿检测器误判。

## 7. 测试方式

测试在 `packages/core/src/index.test.ts`。测试方式使用：

- `FakeModelProvider`（来自 `@vole/models`）——返回预设的工具调用和消息序列，不调用任何 API
- 内联 `PermissionPolicy` 实现——对特定工具返回特定决策
- `InMemoryRuntimeTraceStore`——收集事件用于断言

测试类别：
- 基础消息往返（无工具）
- 工具调用 → 结果 → 第二次模型调用
- 权限 allow / deny / ask 流程
- 规划停顿检测（单次停顿、达到重试上限、完成语言绕过）
- `update_todos` 触发 `todos_updated` 事件
- 步数上限终止
- `SessionMutex` 防止并发 turn
- 流式路径（通过 `FakeStreamingModelProvider`）

## 8. 关键洞察

**循环本质上是一个带权限门控的 while 循环。** 去掉事件发射和 hooks，核心循环很简单：
调用模型，如果请求工具就执行，重复。所有复杂性都在约束里：有界步数、可观察事件、
会话串行化、安全工具执行。

**`deny` 停止运行；工具错误不会。** 一个常见的初始假设是任何失败都应该停止循环。
实际行为更细致：工具错误（找不到工具、执行异常）作为工具结果消息返回给模型。只有
明确的 `deny`/`block` 决策和基础设施错误才触发 `run_failed`。模型被期望作为工具层面
失败的决策者。

**规划停顿检测调校得很保守。** 多个守卫防止误判：700 字符长度上限、完成语言绕过、
在没有结构化计划格式时要求动作动词。目标是只捕获"叙述计划而不行动"的模式，而不是
标记摘要或简短的对话回复。

**Mutex 是无锁的。** `SessionMutex` 用 Promise 链实现每会话串行化——不依赖任何外部
同步原语。每次 `acquire()` 追加到链上，返回一个推进链条的 `release` 函数。

## 9. 复习问题

1. `@vole/core` 的单一职责是什么？它明确不拥有什么？
   > 运行 agent turn 循环——context 组装、模型推理、权限评估、工具执行。不拥有：适配器
   > 渲染、厂商 API SDK、会话持久化、技能加载。POS 注释：「协调一次 turn，不拥有适配器
   > 或厂商 API」。

2. 为什么 `runTurn` 用 `AsyncGenerator` 而不是 `Promise<RuntimeEvent[]>`？
   > 适配器需要在循环运行时就能观察它——流式输出 token、显示权限提示、展示工具进度。
   > `Promise<RuntimeEvent[]>` 会缓冲所有内容，只在 turn 结束后一次性交付，这让流式
   > 输出和交互式审批都无法实现。

3. 工具调用因执行异常失败。运行是否终止？模型在下一步看到什么？
   > 运行**不会**终止。异常被捕获，发射 `tool_failed`，错误消息作为
   > `{ role: "tool" }` 消息推入 `toolResultMessages`。下次模型调用时，模型看到：
   > `Error: <异常消息>`。模型可以选择重试、换工具或报告问题。

4. 工具调用从权限策略得到 `deny`。发射了哪些事件？模型能看到拒绝信息吗？
   > 事件：`tool_call_permission_evaluated`（含 `decision: deny`），然后 `run_failed`。
   > 模型**看不到**拒绝信息——`hardTerminate` 立即被设置，运行在工具结果组装成消息之前
   > 就已结束。

5. `hadRealToolCallThisTurn` 是做什么的，为什么在真实工具调用后跳过停顿检测？
   > 它追踪本轮是否有任何非 `update_todos` 的工具执行过。一旦真实工作已经发生，后续
   > 的纯文字消息是结果报告而非规划停顿。没有这个守卫，模型在完成任务后写摘要会被
   > 误判为计划叙述。

6. 如果对一个倾向于写长规划摘要的模型使用 `executionContract: "strict-agentic"` 会发生什么？
   > 系统提示会追加指令："立即行动，不要叙述计划。" 停顿重试预算从 2 增加到 3。但是，
   > 超过 700 字符的响应永远不会被标记为停顿——所以长摘要无论如何都不会触发停顿检测。

7. `SessionMutex` 是如何工作的？如果没有它，在多轮会话中会出现什么问题？
   > 它为每个 `sessionId` 构建一条 Promise 链。每次 `acquire()` 等待上一个 Promise
   > resolve 后才继续，然后返回一个推进链条的 `release` 函数。没有它，两个并发调用者
   > （比如 CLI 和后台调度器）可能同时对同一会话运行 `runTurn`，导致消息历史交错和
   > 会话状态损坏。

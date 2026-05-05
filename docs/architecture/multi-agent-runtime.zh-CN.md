# Multi-Agent Runtime

状态：Phase 10
日期：2026-05-05

English version: [multi-agent-runtime.md](./multi-agent-runtime.md)

## 1. 目的

本文档描述 ArvinClaw 如何支持以协调方式运行多个 `AgentRuntime` 实例，从 Phase 10 的进程内 sub-agents 开始。

## 2. Sub-Agent 概念

Sub-agent 是由父 agent 创建的第二个 `AgentRuntime` 实例，用于处理专注的子任务。父 agent 委托一个目标，并收到 sub-agent 的最终文本响应。Sub-agent 使用自己的 context、tools 和 step limit 运行。

Sub-agents 适用于以下情况：

- 子任务需要独立的专注执行 context。
- 父 agent 希望交出一个定义明确的有界目标。
- 父 agent 不希望自己的对话历史被子任务步骤污染。

在 Phase 10 中，sub-agents 在进程内运行。除了在 spawn 时传递的 `goal` 和可选的 `context` 字符串，以及完成时返回的结果字符串外，sub-agents 与父 agent 不共享任何内存。

## 3. SubagentFactory Interface

`SubagentFactory` interface 将 spawn 逻辑与 `createSpawnSubagentTool` 函数解耦：

```ts
export interface SubagentFactory {
  create(goal: string): AgentRuntime;
}
```

factory 接收目标字符串并返回完全配置好的 `AgentRuntime`。调用方（通常是 CLI 或 Web adapter）负责用正确的 config、provider 和 tools 构造 factory。

这个 interface 位于 `packages/core`，因为 `AgentRuntime` 定义在那里。将 factory 保留在 core 中可以避免循环导入：tools 不从 core 导入任何内容，core 从 tools 导入 `ExecutableTool`。

## 4. createSpawnSubagentTool

`createSpawnSubagentTool(factory: SubagentFactory): ExecutableTool` 返回一个 tool，父 agent 可以调用它来 spawn sub-agent：

- Tool 名称：`spawn_subagent`
- 风险级别：`medium`
- 输入：`{ goal: string; context?: string }`
- 输出：成功时 `{ ok: true; result: string }`，失败时 `{ ok: false; error: string }`

该 tool 驱动 sub-agent 的 `runTurn` generator，收集 `assistant_message_created` 事件，并将内容作为结果返回。如果 sub-agent 发出 `run_failed`，tool 返回错误结果。

## 5. 事件转发

在 Phase 10 中，父 agent 不将 sub-agent runtime events 转发到自己的事件流。从父 agent 的角度来看，sub-agent 静默运行；只有最终结果（或错误）作为 tool 的输出返回。

未来阶段可能会为可观察性添加事件转发。

## 6. 深度限制

Sub-agents 默认以 `maxSteps: 8` 创建，而父 agent 为 `maxSteps: 12`。这限制了递归开销。Sub-agents 不应该 spawn 自己的 sub-agents；用于 sub-agents 的 factory 不应在其 tool 列表中包含 `spawn_subagent`。

## 7. 参考

- [Node Protocol](./node-protocol.zh-CN.md) — sub-agents 最终将参与的未来多节点方向
- [Gateway](./gateway.zh-CN.md) — 将追踪 sub-agent sessions 的 session 协调层
- [Agent Loop](./agent-loop.zh-CN.md) — sub-agents 运行的 `AgentRuntime` loop

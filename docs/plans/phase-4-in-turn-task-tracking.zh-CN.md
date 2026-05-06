# Phase 4：In-Turn 任务追踪

状态：完成
日期：2026-05-04

English version: [phase-4-in-turn-task-tracking.md](./phase-4-in-turn-task-tracking.md)

## 1. 目的

实现 `update_todos` tool 和规划停滞检测，对齐 OpenClaw 已确认的 `update_plan` / 规划停滞架构。

来源确认：`docs/research/openclaw-implementation-notes.md` 第 8 节（第三轮研究，2026-05-04）。

## 2. 设计概述

OpenClaw 的 in-turn 执行模式：

```
model_response
  → 如果只有规划文字且没有 tool calls：注入重试指令
  → 如果有 tool calls：执行 tools，将结果反馈
  → 模型可以在任意时刻调用 update_plan 追踪步骤进度
```

Peewit Phase 4 通过两个交付物实现这一模式：

1. `update_todos` tool — 模型调用的全量替换步骤追踪器
2. `AgentRuntime` 中的规划停滞检测 — 检测并重试 plan-only turns

## 3. Part A：`update_todos` Tool

### 接口

```typescript
// Tool name: update_todos
// Input schema:
{
  todos: Array<{
    content: string;          // 步骤描述
    status: "pending" | "in_progress" | "completed";
  }>
}
```

同一时刻最多一个条目处于 `in_progress` 状态（已验证）。

### 行为

- 模型在 turn 期间的任意时刻调用 `update_todos`。
- `AgentRuntime` 在当前 run 状态中存储最新 todo 列表。
- Tool 返回 `{ ok: true }` — 模型立即继续。
- 列表变更时 CLI 渲染当前 todo 列表。
- Todo 列表在每次新 turn 开始时重置。

### Package

在 `packages/tools/src/index.ts` 中添加 `createUpdateTodosTool()`。这是一个普通的 `ExecutableTool` — 不需要特殊基础设施支持。

### CLI 展示

每次 assistant 响应后，如果 `update_todos` 被调用，显示：

```
Tasks:
  ✓ Read the README
  → Write a summary  (in progress)
  · Create a pull request
```

## 4. Part B：规划停滞检测

### 检测 Pattern

在 `AgentRuntime` 中，收到 `type: "message"` 模型响应（无 tool calls）后，检查响应是否像 planning-only 输出：

```typescript
const PLAN_PROMISE_RE = /\b(I'?ll|let me|I'm going to|I will|I plan to)\b/i;
const PLAN_HEADING_RE = /^(plan|steps|approach|here'?s what I|my plan)[:\s]/im;
const PLAN_BULLET_RE = /^(\d+\.|[-*])\s+\w/m;
```

如果响应匹配以上任意 pattern 且没有 tool calls，则认为是 "planning-only"。

### 重试指令

检测到 planning-only 响应时，向 context 注入系统级重试消息：

```
Do not restate the plan. Act now: take the first concrete tool action you can.
```

然后用此注入消息重新运行模型。

### 终止

连续 `maxPlanningStallRetries` 次 planning-only turns（默认：2）后，以下列消息 emit `run_failed`：

```
Agent stopped after repeated plan-only turns without taking action.
```

### 配置

在 `AgentRuntimeDependencies` 中添加 `maxPlanningStallRetries?: number`（默认：2）。

## 5. Part A 测试要求

- `update_todos` tool 验证 schema（最多一个 `in_progress`）
- 有效列表的 tool call 返回 `{ ok: true }`
- 无效状态值被明确拒绝
- 空列表被接受（重置追踪器）
- 模型调用后 CLI 渲染更新的 todo 列表

## 6. Part B 测试要求

- Planning-only 检测在承诺短语上触发
- Planning-only 检测在步骤标题上触发
- Planning-only 检测在项目符号列表上触发
- 当模型至少调用一个 tool 时检测不触发
- 首次停滞时注入重试指令
- 连续 `maxPlanningStallRetries` 次停滞后 run 终止
- 模型在停滞限制前行动时 run 不终止

## 7. 实现顺序

1. `packages/tools/` 中的 `update_todos` tool
2. 将 `update_todos` 接入 `AgentRuntime` 并在 CLI 中注册
3. CLI todo 展示
4. `AgentRuntime` 中的停滞检测
5. core 中的停滞检测测试

## 8. 非目标

- 不做基础设施驱动的分步编排
- 不做 subagent spawning
- 不做持久化 TaskFlow
- 不做阻塞执行的预执行计划审批门

## 9. 相关文档

- [Roadmap Phase 4](../roadmap/overview.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [OpenClaw Implementation Notes 第 8 节](../research/openclaw-implementation-notes.zh-CN.md)

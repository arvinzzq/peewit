# Phase 4：规划与自主执行

状态：草案
日期：2026-05-04

English version: [phase-4-planning-and-autonomy.md](./phase-4-planning-and-autonomy.md)

## Progress

状态：已完成

已完成：

- Part A：packages/planner — Plan、PlanStep、PlanStepStatus、Planner 接口、PlannerContext、支持 create_plan tool 注入和 fallback 的 ModelBasedPlanner。7 个测试。
- Part B：packages/core — 7 个 plan event 类型添加到 runtimeEventTypes；inner loop 提取为 #runInnerLoop()；plan-driven 执行的 #runWithPlan()；PlanApprovalResolver 接口；AgentRuntimeDependencies 中的 planner 和 planApprovalResolver。6 个 planner 集成测试。
- Part C：apps/cli — --plan 标志、createConfigured 中的 ModelBasedPlanner wiring、renderPlanProgress()、CliChatTurnResult.planLines、observe 模式 plan approval 的 createCliPlanApprovalResolver、plan events 的 trace event labels。
- 文档整理。

剩余：无。Phase 4 已完成。

## 1. 目的

Phase 4 使 ArvinClaw 能够在执行复杂目标之前将其分解为步骤，以可见的方式跟踪步骤进度，并在三种自主性模式（`observe`、`confirm`、`auto`）下保持一致和可预测的行为。

Phase 1–3 的 agent loop 已通过 tool-calling while 循环处理多步执行。Phase 4 在此之上添加一个更高层次的规划层：在执行 tools 之前，Agent 首先生成一个用户可以审查的结构化计划。

参考：[Agent Loop, Section 12: Planner Evolution](../architecture/agent-loop.zh-CN.md)

## 2. 用户结果

Phase 4 之后：

- 用户可以给 Agent 一个复杂的多步目标（例如"总结这个项目中所有 markdown 文件"）。
- 在行动之前，Agent 展示一个计划：编号步骤，每步都有简短说明。
- 在 `observe` 模式下，用户在每步开始前审查并批准计划。
- 在 `confirm` 模式下，计划展示后自动执行，除非 tool call 需要批准。
- 在 `auto` 模式下，规划和执行无中断运行。
- 每步进度在 `/trace` 中可见。
- 步骤失败被记录，Agent 可以尝试恢复。

## 3. 范围

Phase 4 包括：

- `packages/planner`：`Plan`、`PlanStep`、`Planner` 接口、`ModelBasedPlanner`。
- 新 runtime events：`plan_created`、`plan_step_started`、`plan_step_completed`、`plan_step_failed`、`plan_completed`。
- `AgentRuntime` 可选 `planner` 依赖；plan loop 包裹现有 tool-calling inner loop。
- CLI plan 渲染和 `observe` 模式下的 plan 级 approval。
- 明确 plan 级决策的自主性模式行为。

Phase 4 不包括：

- 跨 session 的 plan 持久化。
- 用户编辑已生成的计划。
- 每步子 Agent 委托。
- 并行步骤执行。
- Plan 版本历史。
- Streaming 模型输出（Phase 6）。

## 4. 架构

### 4.1 Plan 类型

```typescript
// packages/planner
export type PlanStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  result?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface Planner {
  createPlan(goal: string, context: PlannerContext): Promise<Plan>;
}

export interface PlannerContext {
  systemInstruction: string;
  availableTools: string[];
}
```

### 4.2 ModelBasedPlanner

`ModelBasedPlanner` 使用 model provider 和特殊 system instruction 生成结构化计划。Planner 通过 `create_plan` tool definition 调用模型一次。模型返回一个带有 plan steps 作为 input 的 tool call，这比解析自由文本响应更可靠。

### 4.3 AgentRuntime 集成

`AgentRuntime` 增加可选 `planner?: Planner` 依赖。当提供 planner 时，`runTurn()` 先调用 `planner.createPlan(goal)`，emit `plan_created` event，然后逐步执行。不提供 planner 时，行为与 Phase 3 完全一致（向后兼容）。

### 4.4 新 Runtime Events

新增 plan 相关 events：`plan_created`、`plan_approval_requested`、`plan_approval_resolved`、`plan_step_started`、`plan_step_completed`、`plan_step_failed`、`plan_completed`。

### 4.5 自主性模式行为

| 事件 | observe | confirm | auto |
| --- | --- | --- | --- |
| `plan_created` | 暂停、展示计划、请求批准 | 展示计划、自动继续 | 自动继续 |
| `plan_step_started` | 暂停、展示步骤 | 展示步骤 | 静默 |
| tool call（low risk） | ask | allow | allow |
| tool call（medium risk） | ask | ask | allow |
| tool call（high risk） | ask | ask | ask |
| tool call（blocked） | deny | deny | deny |

`observe` 模式在现有 tool-call approval flow 之上添加 plan 级暂停。

### 4.6 CLI Plan 渲染

CLI 在 `observe` 模式下展示计划并请求批准。步骤渲染使用 compact trace output 路径。完整 Ink live updates 推迟到 Phase 6（streaming）。

## 5. 学习文档

更新：

- `docs/architecture/agent-loop.md` — planner evolution 部分
- `docs/architecture/runtime-composition.md` — planner 在 composition 中的位置

## 6. 验收标准

Phase 4 完成标准：

- `packages/planner` 导出 `Plan`、`PlanStep`、`Planner` 和 `ModelBasedPlanner`。
- `ModelBasedPlanner` 通过 `create_plan` tool call 生成结构化计划。
- `AgentRuntime` 接受可选 `planner` 依赖。
- 提供 planner 时，`runTurn()` 发出 plan 相关 events。
- `observe` 模式下，CLI 在执行步骤前请求 plan approval。
- 每步使用现有 inner agent loop 执行。
- 步骤失败记录在 trace 中，不终止整个计划。
- 不提供 planner → `runTurn()` 行为与 Phase 3 完全一致（向后兼容）。
- 所有测试通过，`pnpm run check` 成功。

## 7. 非目标

- 不做跨 session 的 plan 持久化。
- 不允许用户在执行前编辑生成的计划。
- 不做 plan 分支或条件步骤。
- 不做子 Agent 派生。
- 不做并行步骤执行。
- 不做实时终端 UI 更新（Phase 6 / Ink）。

## 8. 规划工作

建议顺序：

### Part A：Planner Package

1. 创建 `packages/planner`，含 `Plan`、`PlanStep`、`Planner`、`PlannerContext` 类型。
2. 实现 `ModelBasedPlanner`，注入 `create_plan` tool。
3. 添加 `packages/planner` source header、README、AGENTS。
4. 使用 fake model provider 添加 planner tests。

### Part B：Runtime 集成

1. 为 `packages/core` 添加 plan event 类型。
2. 向 `AgentRuntimeDependencies` 添加 `planner?: Planner`。
3. 在 `AgentRuntime.runTurn()` 中实现 plan loop。
4. 更新 `packages/core` source header 和模块文档。
5. 添加 runtime plan event tests。

### Part C：CLI Plan 渲染

1. 向 CLI 添加 plan 展示（`plan_created`、步骤进度）。
2. 在 `observe` 模式下添加 plan approval 处理。
3. 更新 CLI help text 和 `/trace` 以显示 plan events。
4. 更新 `apps/cli` source header 和模块文档。
5. 添加 CLI plan 展示测试。

### 文档整理

1. 更新 `agent-loop.md` planner evolution 部分。
2. 更新 roadmap Phase 4 状态。
3. 更新 README。

## 9. 测试

必需的 Phase 4 测试：

- `ModelBasedPlanner` 从模型的 `create_plan` tool call 生成计划。
- 无步骤的计划产生正常结果。
- 每步触发 inner agent loop 执行。
- 步骤失败被记录，不终止计划。
- `observe` 模式在执行前 emit `plan_approval_requested`。
- `confirm` 模式在没有 plan approval request 的情况下继续。
- `auto` 模式在没有 plan approval 或暂停的情况下继续。
- Plan events 出现在 compact trace output 中。
- 不提供 planner → 与 Phase 3 相同的 event 序列。

## 10. Commit 计划

建议 commits：

1. `feat(planner): add Plan types and ModelBasedPlanner`
2. `feat(core): add plan events and planner integration to AgentRuntime`
3. `feat(cli): add plan display and observe-mode plan approval`
4. `docs: update agent-loop and complete phase 4`

## 11. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [Permission System](../architecture/permission-system.zh-CN.md)
- [CLI Adapter](../architecture/cli-adapter.zh-CN.md)
- [Runtime Composition](../architecture/runtime-composition.zh-CN.md)

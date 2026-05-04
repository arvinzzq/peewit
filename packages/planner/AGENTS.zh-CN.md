# Planner Agent Guide

## Responsibility

把 goal 分解和 plan 生成保持在这里。这个 package 提供 Planner 接口、Plan 和 PlanStep 类型，以及 ModelBasedPlanner。调用方注入 ModelProvider；planner 调用它一次，通过 create_plan tool 生成结构化计划。步骤执行属于 AgentRuntime，不属于这里。

## When Files Change

当 plan 类型、planner 接口或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

从 tool call 响应生成计划、fallback 行为（message、error、empty steps）、step ID 分配、所有步骤的 pending 状态，以及 tool/goal 注入 model context 都需要测试。

## Boundaries

不要在这里执行 plan steps、管理权限、为每步重复调用 model providers，或拥有 session state。Planner 生成计划；AgentRuntime 执行它。

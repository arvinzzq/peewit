# Planner Package

## Architecture Summary

这个目录拥有 goal 分解和 plan 生成。
它调用模型一次，通过 `create_plan` tool 在 AgentRuntime 执行步骤之前生成结构化计划。
它提供 Planner 接口，使实现可以被替换而不改变 AgentRuntime。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 planner package 及其对 models 的依赖。 |
| `tsconfig.json` | TypeScript config | 使用对 models 的 reference 构建 planner package。 |
| `src/index.ts` | Planner | 导出 Plan、PlanStep、PlanStepStatus、Planner 接口、PlannerContext，以及支持可注入 ModelProvider 和 create_plan tool 注入的 ModelBasedPlanner。 |
| `src/index.test.ts` | Planner tests | 保护从 tool call 响应生成计划、fallback 行为、step ID 分配、pending 状态和 model 请求内容。 |

## Update Reminder

目录结构变化时更新此文件。

# Gateway Agent Guide

## Responsibility

保持这个 package 专注于 session 注册表操作：register、unregister、touch、get、list 和 listByAdapter。Gateway 追踪哪些 sessions 是活跃的以及哪个 adapter 拥有它们。它不做路由决策、不运行 agent 逻辑、不持有对话状态。

## When Files Change

当注册表职责或 file inventory 变化时，更新本地 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

所有注册表操作都需要单元测试。使用固定时间戳和来自 `@vole/adapters` 的 capability constants。不需要真实 API keys 或文件系统访问 — gateway 是纯内存注册表。

## Boundaries

不要在这个 package 中放 agent 逻辑、tool execution、permission decisions、session message history 或 trace storage。这些分别属于 `packages/core`、`packages/tools`、`packages/permissions` 和 `packages/sessions`。

# TaskFlow Agent Guide

## Responsibility

把 persistent cross-session task graph state 保持在这里。存储带 lifecycle status、progress summaries、terminal summaries 和 parent/child 关系的 task records。Runtime code 应依赖 `TaskFlowStore` interface，而不是了解 storage details。

## When Files Change

当 task graph responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

TaskFlow logic 需要 create、update、get、list、按 status 过滤、按 parentId 过滤、limit 和缺失 id 时的 undefined 行为的测试。

## Boundaries

不要在这个 package 中 assemble prompts、调用 model providers、执行 tools、渲染 CLI output 或管理 session conversation records。Session conversation storage 属于 `packages/sessions`。

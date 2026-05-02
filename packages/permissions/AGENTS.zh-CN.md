# Permissions Agent Guide

## Responsibility

把 risk classification 和 approval policy 保持在这里。Adapters 可以询问用户，但这个 package 应决定是否需要 approval。

## When Files Change

当 permission responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Permission logic 将需要 risk levels、autonomy modes、allow/ask/deny decisions 和 trace-safe explanations 的测试。

## Boundaries

不要在这个 package 中执行 tools、渲染 prompts 或收集用户 approval UI。

# Context Agent Guide

## Responsibility

把 model-facing context selection 和 assembly 保持在这里。这个 package 应产生 provider-neutral model input，以及解释 included 或 omitted 内容的 reports。

## When Files Change

当 context sources、ordering 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Context ordering、included sections、omitted sections 和未来 redaction behavior 需要测试。不要依赖 CLI rendering 或 provider-specific formatting。

## Boundaries

不要在这里调用 model providers、执行 tools、读取 secrets 或渲染 terminal output。

# Sessions Agent Guide

## Responsibility

把 short-term conversation records、durable JSONL session storage 和未来 trace persistence 保持在这里。Runtime code 应依赖 session interface，而不是了解 storage details。

## When Files Change

当 persistence responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Session logic 需要 create、append、load、ordering、defensive copies、write safety、unsafe session IDs 和 replay behavior 的测试。

## Boundaries

不要在这个 package 中 assemble prompts、调用 providers、执行 tools 或渲染 CLI output。

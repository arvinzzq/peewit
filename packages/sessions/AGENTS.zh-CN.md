# Sessions Agent Guide

## Responsibility

在此保持 short-term conversation records、durable JSONL session storage、durable trace persistence 和跨进程 session 文件锁。Runtime code 应依赖 session interface，而不是了解 storage details。文件锁与 `@vole/lanes` 中的进程内 session lane 组合：lane 在一个 Node 进程内排序写入，文件锁在多进程间排序写入。

## When Files Change

当 persistence 或锁职责或 file inventory 变化时更新 README 和 AGENTS。当 inputs、outputs 或 system position 变化时更新 `src/index.ts` 头。

## Testing

Session logic 需要 create、append、load、session listing、message and trace ordering、defensive copies、write safety、unsafe session IDs、replay behavior 的测试。文件锁需要获取、幂等释放、活进程持有时超时、陈旧 pid 回收、陈旧时长回收、进程内串行化的测试。Store 层集成测试必须验证锁文件在每次 append 周围被创建并清理。

## Boundaries

不要在此 package 中 assemble prompts、调用 providers、执行 tools 或渲染 CLI output。不要依赖 `@vole/core` 或 `@vole/lanes` —— 文件锁是叶原语，任何层都可以与之组合。

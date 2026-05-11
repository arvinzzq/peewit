# Permissions Agent Guide

## Responsibility

拥有两件事：(1) 风险分类 + 审批策略（allow / ask / deny）以及 (2) Phase 16 引入的 `SandboxBackend` 执行边界抽象。Adapter 可以询问用户，但本 package 决定是否需要审批，以及工具应通过哪个 sandbox 后端运行。

## When Files Change

当 permission responsibilities、sandbox 后端语义或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。EN 与 zh-CN 之间的 heading 对等必须保持以通过 docs:check。

## Testing

Permission logic 需要 risk levels、autonomy modes、allow/ask/deny decisions、blocked actions 和 trace-safe explanations 的测试。

Sandbox 测试必须覆盖每个后端：name、`available()` 真值、良性命令执行（stdout + exit code）、workspace-escape 拒绝、cwd 包含、timeout 报告为 `{ completed: false, reason: "timeout" }`、非零 exit code 传播。Phase 16b 加入的 Docker / Worker 后端应通过共享一致性测试套件以匹配同一组断言。

## Boundaries

不要在本 package 中通过 `SandboxBackend` 之外的方式执行 tools，不要渲染 prompts，不要收集用户 approval UI。

Sandbox 后端拥有 process / container / worker 的 spawn —— Phase 16 接线落地后 `@vole/tools` 通过 `sandbox.execute(...)` 调用而非直接 spawn 进程。Tools 不越过后端接口。

需要外部运行时（Docker daemon、worker thread、未来的远程调度）的后端实现自己通过 `available()` 暴露可用性检查；调用方必须优雅降级，而不是因为基础设施缺失就抛异常。

# Core Agent Guide

## Responsibility

保持这个 package 专注于 runtime coordination、short-term context handoff、model-requested tool-call events、permission evaluation events、共享 runtime contracts 和 trace storage interfaces。它可以编排注入依赖，但不应该读取环境变量、渲染 CLI output、执行 tools、收集 approval UI 或直接调用厂商 API。

## When Files Change

当 runtime responsibilities 或 file inventory 变化时，更新本地 README 和 AGENTS 文件。当 runtime dependencies、exports 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Runtime event order、trace storage、short-term context handoff、tool-call request events、permission evaluation events、failure events 和 dependency injection behavior 需要单元测试。使用 fake providers、fake assemblers 和注入的 fake permission policies；不要使用真实 API keys。

## Boundaries

不要把 prompt construction、CLI rendering、model SDK code、tool implementation 或 permission UX 放进这个 package。

# Gateway Agent Guide

## 职责

两层：

1. `SessionGateway` —— session 注册表：register、unregister、touch、get、list、listByAdapter。
2. `GatewayCore` —— Phase 11 扩展：通过 `@vole/lanes` 准入 run，支持 cancel，暴露 status。继承 `SessionGateway`。

Phase 11 起 gateway 是每个 agent run 的唯一入口。Adapter 提交 `RunRequest`；gateway 把它穿过 lane 准入并派发调用方提供的 run 函数。

## 文件变更时

当注册表或准入职责变化、或 file inventory 变化时更新本地 README 和 AGENTS。当 inputs、outputs 或 system position 变化时更新 `src/index.ts` 头。头注释标记（INPUT / OUTPUT / POS）由 `scripts/check-docs.ts` 强制。

## 测试

所有注册表操作与准入路径都需要单元测试。注册表测试用固定时间戳；lane 准入与取消测试用 `deferred()` 辅助控制时序。无需真实 API key 或文件系统访问 —— gateway 是纯进程内协调。

## 边界

不要在此 package 放入 agent 逻辑、tool 执行、权限决策、session 消息历史或 trace 存储。它们分别属于 `packages/core`、`packages/tools`、`packages/permissions`、`packages/sessions`。

不要 import `@vole/core`。调用方提供 `run(signal) => AsyncIterable<events>` 回调；gateway 在 lane 链内调用它。这种反转保持依赖图无环，并让 gateway 不启动 runtime 也能测试。

Subscribe（让第二个 consumer 接入已有 run 的事件流）推迟到 Phase 12，channel 与 Web UI 真正需要时再做。Phase 11 只交付 `submit / cancel / status`。

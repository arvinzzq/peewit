# Gateway Package

## Architecture Summary

这个目录拥有 ArvinClaw 的 session gateway 注册表。
它跨 adapter 追踪活跃 sessions，使多入口协调成为可能。
它不包含任何 agent 逻辑 — 它是一个注册表，记录哪些 sessions 存在以及哪个 adapter 拥有它们。

English version: [README.md](./README.md)

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 gateway package 及其对 `@arvinclaw/adapters` 的依赖。 |
| `tsconfig.json` | TypeScript config | 使用对 `packages/adapters` 的引用构建 gateway package。 |
| `src/index.ts` | Session gateway | 导出 `GatewaySession` 记录类型、包含 register/unregister/touch/get/list/listByAdapter 的 `SessionGateway` 类，以及 `gatewayPackageName` 常量。 |
| `src/index.test.ts` | Gateway tests | 保护 register、unregister、touch、list、listByAdapter 和 get 行为，包括边缘情况（未知 session、空列表、no-op touch）。 |

## Update Reminder

目录结构变化时更新此文件。

# Phase 7 多入口 Adapters 计划

状态：进行中
日期：2026-05-05

English version: [phase-7-multi-entry-adapters.md](./phase-7-multi-entry-adapters.md)

## 进度

状态：完成

已完成的 commits：

- [x] Part A：设计文档 — adapter interface 和 gateway 概念：`33f8a89`
- [x] Part B：`packages/adapters` — `AdapterCapabilities` interface：`7170eaa`
- [x] Part C：`packages/config` — `resolveSessionsDirectory()` helper：`d5c752d`
- [x] Part D：Web durable sessions — Web server 中使用 `JsonlSessionStore`：`3cdfb2d`
- [x] Part E：Web session 管理 UI — sessions 列表页面：`3d87c54`

## 1. 目的

Phase 7 将 Phase 6 非正式建立的 adapter 边界正式化。

Phase 6 证明了 CLI 和 Web 可以共享一个 Agent Core。Phase 7 让这种共享明确化：

- 定义 adapter 可以声明哪些 capabilities。
- 提供 session directory resolution 的共享 helper，使 CLI 和 Web 使用相同路径。
- 将 Web sessions 切换为 CLI 使用的相同 durable `JsonlSessionStore`。
- 在 Web app 中新增 session 管理 UI，让用户可以创建和恢复 sessions。
- 记录 Phase 10 的早期 gateway 方向。

## 2. 范围

本 phase 包括：

- `packages/adapters`：新 package，导出 `AdapterCapabilities` 和规范的 capability 常量。
- `packages/config`：导出 `resolveSessionsDirectory()` helper；CLI 使用它替代私有副本。
- `apps/web`：从 `InMemorySessionStore` 切换到 `JsonlSessionStore`（服务器启动时创建共享 store）。
- `apps/web`：`GET /api/sessions` 返回 store 中的 sessions（含 metadata）；`GET /api/sessions/:id` 返回单个 session metadata。
- `apps/web`：React UI 中的 session 列表页面 — 浏览已有 sessions、创建新 session、恢复 session。
- `docs/architecture/adapters.md` 和 `docs/architecture/gateway.md`。

本 phase 不包括：

- Multi-device sync。
- 完整 OpenClaw-style node network。
- Background adapters（Phase 8）。
- 远程 adapter 注册。
- 认证或多用户 sessions。

## 3. 架构摘要

### AdapterCapabilities

每个 adapter 声明是否能够：

- 显示逐 token 流式输出（`streaming: boolean`）
- 展示交互式 approval UI（`approvalPrompts: boolean`）
- 在没有活跃用户连接的情况下运行（`background: boolean`）

为 CLI、Web 和未来 background adapters 提供规范常量。

### resolveSessionsDirectory

Config package 新增公开的 `resolveSessionsDirectory(config, env)` helper，使用来自 env 或 `process.env.HOME` 的 `HOME` 展开 `~/`。此前该逻辑以私有函数的形式在 CLI 中重复存在。此 phase 后，CLI 和 Web 都使用同一个导出 helper。

### Durable Web Sessions

Phase 7 之前，Web server 使用 `InMemorySessionStore` — 服务器重启后 sessions 丢失。Phase 7 在服务器启动时创建一个共享的 `JsonlSessionStore`，指向与 CLI 相同的目录。内存中的 `sessions` Map 仅保留瞬态 runtime 状态（runtime、approvalResolver、traceStore）。持久 session 数据存储在 store 中。

这意味着：

- 通过 Web 创建的 session 在 `vole sessions` 中可见。
- 通过 CLI 创建的 session 可以在 Web UI 中恢复。
- 服务器重启不会丢失 session history。

### Session 管理 UI

Web UI 新增一个 sessions 页面，在没有活跃 session 时显示。它列出 `GET /api/sessions` 返回的已有 sessions，并提供"New Session"按钮。点击已有 session 即可恢复。

## 4. 验收标准

- `packages/adapters` 导出 `AdapterCapabilities`、`AdapterStorageType`、`CLI_CAPABILITIES`、`WEB_CAPABILITIES` 和 `BACKGROUND_CAPABILITIES`。
- `packages/config` 导出 `resolveSessionsDirectory`。
- CLI 使用 config 中的 `resolveSessionsDirectory`（删除私有函数）。
- Web server 在配置的 sessions 目录使用 `JsonlSessionStore`。
- `GET /api/sessions` 返回含 `id` 和 `updatedAt` 字段的 sessions。
- `GET /api/sessions/:id` 返回单个 session metadata。
- Web UI 在未选择 session 时显示 sessions 列表页面。
- CLI 创建的 sessions 在 Web UI session 列表中可见。
- 每个 part 完成后 `pnpm run check` 通过。

## 5. 非目标

- 不做完整 OpenClaw-style node network。
- 不做复杂 multi-device sync。
- 不做认证或多用户隔离。
- 不做远程 adapter 注册协议。

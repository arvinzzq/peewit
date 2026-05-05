# Phase 10：完整个人 Agent 平台

状态：进行中
日期：2026-05-05

English version: [phase-10-full-platform.md](./phase-10-full-platform.md)

## 1. 目标

将 ArvinClaw 打造为完整个人 Agent 平台：多入口、多模型、多 Agent、可观察，并足够安全以支持日常使用。

## 2. 各部分

### Part A：设计文档

在编写任何代码之前先创建 Phase 10 的架构文档。

- `docs/plans/phase-10-full-platform.md` + zh-CN（本文档）
- `docs/architecture/multi-agent-runtime.md` + zh-CN
- `docs/architecture/node-protocol.md` + zh-CN
- `docs/architecture/sandboxing.md` + zh-CN
- 更新 `docs/architecture/gateway.md` + zh-CN，添加 Phase 10 实现部分
- 更新 `docs/roadmap/overview.md` + zh-CN：Phase 10 → In Progress

### Part B：Sub-Agent Spawning

向 `packages/core` 添加 `SubagentFactory` interface 和 `createSpawnSubagentTool`。向 `packages/tools` 添加 `SpawnSubagentResult`。

### Part C：Gateway Package

创建 `packages/gateway`，包含 `SessionGateway` 类，用于跨 adapter 追踪活跃 sessions。

### Part D：在 CLI 和 Web 中接入

在 CLI sessions 中注册 `spawn_subagent` tool。在 CLI 和 Web adapters 中向 `SessionGateway` 注册 sessions。向 Web server 添加 `GET /api/gateway/sessions` endpoint。

## 3. 提交序列

1. `docs: add Phase 10 design — full personal agent platform`
2. `feat(core,tools): add spawn_subagent tool and SubagentFactory interface`
3. `feat(gateway): add SessionGateway registry for multi-adapter session tracking`
4. `feat(cli,web): wire spawn_subagent tool and register sessions in SessionGateway`
5. `docs: mark Phase 10 complete`

## 4. 验收标准

- 多个入口（CLI、Web）在共享的 `SessionGateway` 注册表中注册各自的 sessions。
- CLI sessions 可以通过专用的 `spawn_subagent` tool 启动 sub-agents。
- Sub-agents 以受限的 `maxSteps` 运行，防止无限递归。
- `GET /api/gateway/sessions` endpoint 返回已注册的 gateway sessions 列表。
- `SpawnSubagentResult` 是 `packages/tools` 中 `ToolExecutionResult` union 的一部分。
- 每次提交前 `pnpm run check` 必须通过。
- 每个 sub-agent spawning 场景都有测试覆盖（成功和失败路径）。
- 所有新 packages 和文件都有双语 EN + zh-CN 文档。

## 5. 非目标

- 本阶段不涉及多进程或远程节点通信；sub-agents 在进程内运行。
- 本阶段不在父 agent 和 sub-agents 之间做 workspace 隔离。
- 不保证与 OpenClaw 完整 node protocol 完全对等。
- 不假设 enterprise SaaS。
- 除 `maxSteps` 限制外，不做自动 sub-agent 深度限制。

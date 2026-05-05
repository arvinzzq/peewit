# ArvinClaw Agent Guide

## Project Role

ArvinClaw 是一个从 0 到 1 构建的 OpenClaw-like 个人通用 Agent。
它既是真实产品，也是用于学习 Agent 架构的项目。
每次实现变更都应让 module boundaries、tests 和中英文双语文档保持可理解。

## Documentation Rules

- 重要项目文档保持英文 `.md` 和简体中文 `.zh-CN.md` 成对。
- 当目录结构或职责变化时，更新本地 module README 和 AGENTS 文件。
- 当文件 inputs、outputs 或 architecture position 变化时，更新必需源码文件头。
- 对微小 implementation-only edits，不要更新全局文档，除非 workflow 或 architecture 变化。
- **代码和文档在同一 commit 中移动。** feature 或 refactor commit 必须包含对应的 README、AGENTS 和源码文件头更新——不允许事后单独的补文档 commit。独立的 `docs:` commit 只用于纯文档变更（研究笔记、架构文档、计划）且在实现之前。

## Testing Rules

- 行为变化时添加或更新测试。
- 单元测试不能要求真实 API keys。
- 优先使用 fake providers、fake context assemblers 和 deterministic inputs。
- 完成工作前运行 `pnpm run check`。

## Architecture Boundaries

- CLI 只适配 terminal input/output。
- Core 通过注入依赖编排 runtime behavior。
- Context 组装 provider-neutral model input。
- Models 隔离 provider-specific API details。
- Tools 执行 capabilities，但不决定 permissions。
- Permissions 决定 allow、ask、deny 或 block。
- Sessions 持久化 replayable state 和 traces。

## Update Reminder

当 project-wide agent instructions 变化时更新此文件。

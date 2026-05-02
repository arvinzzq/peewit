# ArvinClaw Documentation

状态：草案
日期：2026-05-02

English version: [README.md](./README.md)

## 1. 目的

这个目录是 ArvinClaw 的产品文档和学习文档中心。

ArvinClaw 旨在成为一个真实的个人通用 Agent 产品，同时也作为一个学习项目，用来理解 OpenClaw-like Agent 架构。文档应该同时解释我们要构建什么，以及每个模块为什么存在。

## 2. 阅读顺序

推荐的第一阅读路径：

1. [Main Design](./product/arvinclaw-design.zh-CN.md)
2. [Roadmap](./roadmap/overview.zh-CN.md)
3. [Reference Systems](./architecture/reference-systems.zh-CN.md)
4. [OpenClaw Architecture Map](./architecture/openclaw-architecture-map.zh-CN.md)
5. [Project Structure](./architecture/project-structure.zh-CN.md)
6. [CLI Adapter](./architecture/cli-adapter.zh-CN.md)
7. [Agent Loop](./architecture/agent-loop.zh-CN.md)

这个顺序从产品意图开始，然后进入架构边界。

## 3. 文档区域

| 区域 | 目的 |
| --- | --- |
| `product/` | 已接受的产品和设计草案 |
| `roadmap/` | 产品阶段、阶段目标、验收标准和非目标 |
| `architecture/` | 模块级架构说明 |
| `research/` | 外部系统调研和来源记录 |
| `decisions/` | 架构决策和权衡 |
| `plans/` | 开始写代码前的阶段实施计划 |

## 4. 当前核心架构文档

基础：

- [Project Structure](./architecture/project-structure.zh-CN.md)
- [Configuration System](./architecture/configuration-system.zh-CN.md)
- [Runtime Composition](./architecture/runtime-composition.zh-CN.md)
- [Architecture Contracts](./architecture/contracts.zh-CN.md)
- [Testing Strategy](./architecture/testing-strategy.zh-CN.md)
- [Development Workflow](./architecture/dev-workflow.zh-CN.md)
- [Documentation System](./architecture/documentation-system.zh-CN.md)

MVP runtime：

- [CLI Adapter](./architecture/cli-adapter.zh-CN.md)
- [Agent Loop](./architecture/agent-loop.zh-CN.md)
- [Model Provider](./architecture/model-provider.zh-CN.md)
- [Prompt Assembly](./architecture/prompt-assembly.zh-CN.md)
- [Context Engine](./architecture/context-engine.zh-CN.md)
- [Execution Trace](./architecture/execution-trace.zh-CN.md)
- [Run Queue](./architecture/run-queue.zh-CN.md)

能力：

- [Tool System](./architecture/tool-system.zh-CN.md)
- [Permission System](./architecture/permission-system.zh-CN.md)
- [Skill System](./architecture/skill-system.zh-CN.md)
- [Session Storage](./architecture/session-storage.zh-CN.md)
- [Memory System](./architecture/memory-system.zh-CN.md)
- [Workspace Files](./architecture/workspace-files.zh-CN.md)

参考和对齐：

- [Reference Systems](./architecture/reference-systems.zh-CN.md)
- [OpenClaw Architecture Map](./architecture/openclaw-architecture-map.zh-CN.md)
- [OpenClaw Implementation Notes](./research/openclaw-implementation-notes.zh-CN.md)

## 5. 计划

相关 phase plan 写好并评审前，不应该开始实现。

计划中的阶段文档：

- [Phase 0 Foundation](./plans/phase-0-foundation.zh-CN.md)
- [Phase 1 MVP Agent Loop](./plans/phase-1-mvp-agent-loop.zh-CN.md)
- [Phase 2 Tools and Permissions](./plans/phase-2-tools-and-permissions.zh-CN.md)

## 6. 决策

当前决策记录：

- [0001：OpenClaw-Aligned Core Architecture](./decisions/0001-openclaw-aligned-core-architecture.zh-CN.md)
- [0002：OpenClaw-Aligned, Not Identical](./decisions/0002-openclaw-aligned-not-identical.zh-CN.md)
- [0003：Technology Stack Selection](./decisions/0003-technology-stack-selection.zh-CN.md)
- [0004：Documentation Maintenance Policy](./decisions/0004-documentation-maintenance-policy.zh-CN.md)

## 7. 语言策略

每个重要项目文档都应该有英文和简体中文两个版本。

规则：

- 英文文件使用 `.md`。
- 简体中文文件使用 `.zh-CN.md`。
- 两个版本必须是同一内容的完整翻译。
- 标题、表格、示例、图表、测试要求和验收标准必须保持结构对齐。
- 更新时应在同一次处理中修改两个语言版本。

## 8. 文档质量标准

每个架构文档都应该解释：

- 为什么这个模块存在
- 它拥有什么职责
- 它有哪些输入和输出
- 它不应该拥有什么职责
- 它如何与其他模块协作
- 哪些测试保护它
- 哪些内容被延后

文档应该足够具体，能够指导实现；但在实现验证前，不应假装它们就是最终代码契约。

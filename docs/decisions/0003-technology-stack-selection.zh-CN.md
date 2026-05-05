# 0003：Technology Stack Selection

状态：已接受
日期：2026-05-03

English version: [0003-technology-stack-selection.md](./0003-technology-stack-selection.md)

## 1. 背景

ArvinClaw 是一个从 0 到 1 构建的 OpenClaw-like 个人通用 Agent。

这个项目有两个目标：

- 构建一个能够逐步用于日常工作的真实产品。
- 通过可读模块、测试和中英文双语文档，学习 OpenClaw-like Agent 的架构。

因此，技术栈既要支持产品成长，也要支持学习清晰度。它应该足够贴近 OpenClaw，让对比有意义；但在 ArvinClaw 真正需要之前，不应该复制生产级复杂度。

OpenClaw 的公开仓库是一个 TypeScript 和 Node.js 项目，并且源码开发使用 pnpm workspaces。它的 workspace 包含 root package、UI、packages 和 extensions。这让 pnpm 成为 ArvinClaw 的重要参考选择。

## 2. 决策

ArvinClaw 将使用：

| 范围 | 选择 |
| --- | --- |
| 主语言 | TypeScript |
| 运行时 | Node.js |
| 包管理器 | pnpm |
| Monorepo 机制 | pnpm workspace |
| 类型检查 | 使用 `tsc -b` 的 TypeScript project references |
| 开发期 TypeScript 执行 | `tsx` |
| 测试运行器 | Vitest |
| 初始构建策略 | Phase 0 不引入 bundler；使用直接 TypeScript 执行和类型检查 |

仓库将使用 `pnpm-workspace.yaml` 记录 workspace 成员，而不是使用 `package.json` 中的 `workspaces` 字段。

## 3. 为什么选择 pnpm

相比 npm workspaces，pnpm 更适合作为 ArvinClaw 的长期选择，因为：

- 它更贴近 OpenClaw 公开源码开发的形态。
- 它适合管理很多 packages 和未来 extensions 的 monorepo。
- 它更严格的依赖解析能更早暴露意外的隐式依赖。
- 随着 package 数量增长，它能保持高效的依赖安装。
- 它为未来的 `apps/`、`packages/`、`extensions/` 和 `ui/` workspaces 提供清晰路径。

初始成本是可以接受的，因为项目还处于早期：

- 开发者本地需要可用的 pnpm。
- 命令从 `npm run ...` 变为 `pnpm run ...`。
- `package-lock.json` 会被 `pnpm-lock.yaml` 替代。
- 因为 pnpm 通常不会像 npm 那样扁平化依赖，一些依赖错误可能更早暴露。

这些成本现在处理，比等到项目拥有更多 packages、scripts、CI jobs 和文档之后再处理要小得多。

## 4. 为什么选择 TypeScript 和 Node.js

TypeScript 和 Node.js 是合适的第一技术栈，因为：

- OpenClaw 基于 TypeScript 和 Node.js。
- CLI、tools、文件系统访问、shell 执行、Web 请求和未来 gateway 工作都很适合 Node.js。
- TypeScript 让模块契约对学习者可见。
- 类型检查和单元测试可以随着系统成长保护架构边界。
- 同一种语言可以支持 CLI、core packages、provider adapters、skills 和未来 Web UI 集成。

这并不阻止后续加入 native 或平台相关组件。桌面应用、移动 nodes、浏览器自动化或 sandbox backends 都可以在后续通过 package boundaries 加入。

## 5. 为什么现在不引入 Bundler

Phase 0 不需要 bundler。

当前目标是建立 package boundaries、tests、configuration、CLI shape 和 documentation。使用 `tsx` 直接运行 TypeScript，可以保持快速反馈，并让 build path 更容易理解。

当出现真实压力时，再引入 bundler：

- CLI 分发
- 单文件 executable packaging
- Web UI builds
- Extension packaging
- 对启动性能敏感
- Release automation

在那之前，`tsc -b`、`tsx` 和 Vitest 已经足够。

## 6. 模块技术栈方向

| 模块 | 初始技术栈 | 未来方向 |
| --- | --- | --- |
| `apps/cli` | TypeScript、`tsx`、Node.js terminal APIs | 需要时引入 rich TUI 或 command runner |
| `packages/core` | TypeScript domain logic | Run queue、session serialization、event streaming |
| `packages/config` | TypeScript validation logic | 需要时引入 JSON schema 或更强 validation library |
| `packages/context` | Deterministic TypeScript prompt assembly | Workspace files、memory retrieval、compaction |
| `packages/models` | OpenAI-compatible HTTP/provider abstraction | Anthropic、Gemini、Ollama、本地 providers |
| `packages/tools` | TypeScript tool registry | File、shell、web、browser、MCP、extension tools |
| `packages/permissions` | TypeScript risk and policy rules | Sandbox integration 和 persisted approvals |
| `packages/skills` | 本地 `SKILL.md` discovery | Plugin SDK 和 marketplace-style extension model |
| `packages/sessions` | 先使用 file-backed JSON/JSONL | 需要查询能力时引入 SQLite 或 embedded database |
| Future Web UI | Phase 0 不包含 | Web UI 开始时再引入 Vite 或其他 UI build tool |

技术栈应该只在某个 phase 真的产生压力时再增长。

## 7. 测试影响

每个模块和迭代都应该有与风险匹配的测试。

早期必需检查：

- 使用 `tsc -b` 做类型检查
- 使用 Vitest 做单元测试
- Package-boundary tests
- CLI behavior tests
- Config precedence 和 redaction tests
- Documentation link 和 bilingual heading checks

未来任何技术栈变化都必须包含测试或检查，证明新工具不会削弱模块边界或文档一致性。

## 8. 后果

正向影响：

- ArvinClaw 保持接近 OpenClaw 的 TypeScript 和 pnpm workspace 方向。
- 项目可以更早获得严格的依赖边界。
- Build path 仍然足够小，适合学习。
- 未来 packages 和 extensions 有自然归属位置。

权衡：

- 贡献者需要使用 pnpm，而不能只依赖 npm。
- 一些依赖问题可能更早出现，并需要显式 package dependencies。
- 未来 bundler 决策仍然被延后。

## 9. 相关文档

- [OpenClaw-Aligned Core Architecture](./0001-openclaw-aligned-core-architecture.zh-CN.md)
- [OpenClaw-Aligned, Not Identical](./0002-openclaw-aligned-not-identical.zh-CN.md)
- [Project Structure](../architecture/project-structure.zh-CN.md)
- [Development Workflow](../architecture/dev-workflow.zh-CN.md)
- [主设计](../product/arvinclaw-design.zh-CN.md)

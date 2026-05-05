# 0004：Documentation Maintenance Policy

状态：已接受
日期：2026-05-03

English version: [0004-documentation-maintenance-policy.md](./0004-documentation-maintenance-policy.md)

## 1. 背景

ArvinClaw 既是一个可用产品，也是一个用于理解 OpenClaw-like Agent 架构的学习项目。

这让文档成为实现的一部分，而不是事后的补充。读者应该可以打开一个模块，理解它在 Agent 系统中的角色，并在阅读每一行代码之前知道哪些文件重要。

与此同时，文档规则也可能变得过重。如果每次小改动都强制更新大量重复注释和全局文档，项目会积累过期文本和噪音提交。

## 2. 决策

ArvinClaw 将使用轻量文件说明政策：

1. 每个架构模块目录都必须有本地 README 和 AGENTS 指南。
2. 每个重要项目文档都必须保持英文和简体中文版本对齐。
3. 核心源码入口文件必须包含一个简短文件头，说明 input、output 和 system position。
4. 测试文件应通过清晰测试名，或在需要时通过简短文件头，说明它们保护的行为。
5. 配置文件、package manifests、生成文件、构建产物和 lockfiles 通过目录 file inventory 说明，不使用源码文件头。

目标是让项目更容易学习和维护，而不是把文档变成仪式。

## 3. 目录文档

以下模块目录需要本地指南：

- `apps/cli`
- `packages/config`
- `packages/context`
- `packages/core`
- `packages/models`
- `packages/permissions`
- `packages/sessions`
- `packages/skills`
- `packages/tools`
- `scripts`
- `tests`

每个模块目录都应包含：

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- `AGENTS.zh-CN.md`

每个 README 应包含：

- 三行 architecture summary
- 包含 file name、role 和 purpose 的 file inventory
- 更新提醒

每个 AGENTS 指南应包含：

- 模块职责
- 文件变化时要更新什么
- 测试期望
- 不应跨越的边界

子目录不需要自己的 README 和 AGENTS 文件，除非它们成为独立架构边界。

## 4. 源码文件头

核心源码入口文件应包含一个简短文件头：

```ts
/**
 * INPUT: Main imports, external APIs, environment variables, or injected dependencies.
 * OUTPUT: Main exports, side effects, or public API surface.
 * POS: The file's position in the ArvinClaw architecture.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
```

这条规则首先适用于：

- `apps/cli/src/index.ts`
- `packages/config/src/index.ts`
- `packages/context/src/index.ts`
- `packages/core/src/index.ts`
- `packages/models/src/index.ts`
- `packages/permissions/src/index.ts`
- `packages/sessions/src/index.ts`
- `packages/skills/src/index.ts`
- `packages/tools/src/index.ts`
- `scripts/check-docs.ts`

生成文件、`dist` outputs、lockfiles、`package.json`、`tsconfig.json` 和 `.tsbuildinfo` 文件不需要源码文件头。

## 5. 更新触发条件

当模块职责变化时：

- 更新源码文件头。
- 更新模块 README file inventory。
- 更新模块 AGENTS 指南。
- 当设计变化时，更新相关 architecture documents。
- 添加或更新保护新行为的测试。

当实现变化但职责不变时：

- 如果行为变化，更新测试。
- 只有在 dependencies、outputs 或 system position 变化时，才更新源码文件头。
- 除非变更影响项目级 workflow 或 architecture，否则不更新全局文档。

当项目 workflow 变化时：

- 更新根 README 文件。
- 如果 Agent instructions 变化，更新根 AGENTS 文件。
- 在相关时更新 development workflow 或 decision documents。

## 6. 代码注释策略

ArvinClaw 应使用注释解释 architecture intent、safety boundaries 和不直观的 trade-offs。注释不应重复清晰命名和测试已经说明的内容。

为以下内容添加简短注释：

- Runtime boundaries 和 event-stream decisions，例如为什么 `AgentRuntime.runTurn` 在 turn 推进时返回 runtime events。
- Security、permission 和 redaction logic。
- Prompt、memory 和 workspace loading order，尤其是围绕 `SOUL.md`、`USER.md`、`MEMORY.md` 和 daily memory files 的加载。
- Persistence formats，例如为什么 JSONL session records 是 append-only 且 replayable 的。
- 仅从代码很难推断的 compatibility 或 workaround logic。

避免为以下内容添加注释：

- 简单变量赋值。
- 显而易见的 control flow。
- 只是重复 function 或 variable name 的注释。
- 应属于 architecture documents 而不是 source code 的大段 prose。

推荐风格是在 decision point 前写短注释。注释应解释代码为什么这样设计，而不是逐行叙述代码做了什么。

## 7. 自动检查

文档检查应强制执行轻量政策：

- 必需模块目录有 README 和 AGENTS 指南。
- 必需双语配对存在。
- 必需源码入口文件有 `INPUT`、`OUTPUT` 和 `POS` header markers。
- Markdown links 保持有效。
- 英文和简体中文文档保持 heading count 对齐。

检查应忽略：

- `node_modules`
- `dist`
- coverage output
- `.tsbuildinfo`
- lockfiles
- generated files

## 8. 后果

正向影响：

- 新贡献者和未来读者可以快速理解每个模块。
- 项目继续适合作为学习资料。
- 架构边界在代码和文档中都变得可见。
- 自动检查减少文档漂移。

权衡：

- 每个新架构模块都需要少量文档工作。
- 源码文件头必须在职责变化时保持准确。
- 部分提交会同时包含代码和文档更新。

这个政策刻意比“每个文件都写长注释”更轻。

## 9. 相关文档

- [Documentation System](../architecture/documentation-system.zh-CN.md)
- [Development Workflow](../architecture/dev-workflow.zh-CN.md)
- [Testing Strategy](../architecture/testing-strategy.zh-CN.md)
- [Project Structure](../architecture/project-structure.zh-CN.md)

# Development Workflow

状态：草案
日期：2026-05-02

English version: [dev-workflow.md](./dev-workflow.md)

## 1. 目的

本文档定义 ArvinClaw 开发工作应该如何规划、实现、测试、记录和提交。

ArvinClaw 既是产品，也是学习项目。工作流应该让进展稳定，同时不隐藏决策、风险或测试缺口。

核心规则：

每个有意义的变更都应该可理解，按风险测试，在改变架构或行为时更新文档，并以可读粒度提交。

## 2. 工作模式

ArvinClaw 工作应经过这些模式：

1. 讨论和设计。
2. 设计文档。
3. Phase plan。
4. 实现。
5. 验证。
6. 提交。
7. Review 和下一步决策。

某个 phase 的相关 phase plan 存在并经过 review 前，不应开始实现。

## 3. 代码前的文档

当一个变更引入或改变 architecture boundary 时，设计应该在实现前或实现同时被记录。

以下情况需要文档：

- 新 packages
- 新 runtime contracts
- Tool 或 permission behavior
- Prompt/context behavior
- Session、trace、memory 或 persistence behavior
- 用户可见 CLI behavior
- 安全敏感行为

小型内部重构可以只需要 commit notes 和 tests。

## 4. 测试期望

每个实现步骤都应该添加或更新与风险匹配的测试。

最低期望：

- 纯逻辑：unit tests。
- 跨 package 行为：integration tests。
- CLI behavior：adapter tests。
- Tool execution 或 permissions：safety regression tests。
- Trace shape：稳定后使用 trace tests 或 golden trace checks。
- 文档结构：文档变化时做 bilingual 和 link checks。

常规测试不应该需要真实 API key 或真实 model call。

## 5. 完成前验证

在声称任务完成前，应运行相关验证命令。

预期验证领域：

- Typecheck
- Unit tests
- Integration tests
- CLI behavior 改变时的 CLI smoke checks
- 文档变化时的 documentation link checks
- 文档变化时的 bilingual heading checks

如果某个验证命令不能运行，需要记录原因。

## 6. Commit Policy

Commits 应该小、可读，并容易回滚。

好的 commit 特征：

- 一个连贯目的。
- 清晰 subject line。
- 尽可能包含相关 tests 或 docs。
- 不把无关 refactors 和 feature work 混在一起。
- 不把多个 phases 打包在一起。

示例：

- `docs: define cli adapter experience`
- `feat(config): load project config`
- `test(permissions): cover blocked secret paths`
- `fix(cli): render provider startup errors`

避免大型兜底 commits，例如：

- `misc changes`
- `update docs`
- `wip`
- `big refactor`

## 7. Commit Boundaries

推荐 commit 边界：

- 一个 architecture document 或紧密相关文档组。
- 一个 package skeleton。
- 一个经过测试的行为。
- 一个 bug fix 和它的 regression test。
- 一次 roadmap 或 reference cleanup。

当一个变更同时触及代码和文档时，如果文档解释的是同一具体行为，可以放在一起。若文档是较宽泛的设计更新，应拆分。

## 8. Branch Policy

项目仍小时可以继续在 default branch 工作，但一旦实现开始触及多个 packages 或风险行为，就应使用 feature branches。

推荐 branch prefix：

```text
codex/
```

示例：

- `codex/phase-0-foundation`
- `codex/mvp-agent-loop`
- `codex/tools-permissions`

## 9. 用户 Review Gates

以下情况前应请求用户确认：

- 开始新的 phase implementation。
- 改变重大架构方向。
- 添加 risky tool behavior。
- 修改 memory 或 identity files。
- 修改 commit 或 documentation policy。
- 移动或删除大段文档。

已批准计划内的常规文档更新可以继续进行，但仍应总结说明。

## 10. 处理 Dirty Worktrees

开始工作前，先检查当前 worktree。

规则：

- 除非用户明确要求，否则不要 revert 用户变更。
- 如果存在无关变更，避免触碰它们。
- 如果存在相关变更，先检查并与之协作。
- 如果现有变更让任务变得模糊，继续前先询问。

## 11. 文档语言工作流

编辑重要文档时：

- 在同一轮中更新英文和简体中文版本。
- 保持 headings 结构对齐。
- 保持 tables、examples、diagrams、testing requirements 和 acceptance criteria 对齐。
- 运行 bilingual heading check。
- 链接变化时运行 Markdown link check。

翻译应该完整，而不是摘要。

## 12. 基于风险的自主性

用户批准方向后，低风险文档清理可以直接进行。

更高风险的实现工作需要更仔细的计划和验证，尤其是触及：

- Shell execution
- File writes
- Secrets
- Permissions
- Memory
- Background automation
- Remote services

## 13. 验收标准

Development workflow 成功标准：

- 工作从已批准 design 或 phase plan 开始。
- Commits 小且可读。
- Tests 按风险添加。
- 声称完成前先验证。
- 文档保持双语和链接可用。
- 用户可以理解改变了什么以及为什么改变。

## 14. 相关文档

- [Documentation System](./documentation-system.zh-CN.md)
- [Testing Strategy](./testing-strategy.zh-CN.md)
- [Architecture Contracts](./contracts.zh-CN.md)
- [Runtime Composition](./runtime-composition.zh-CN.md)
- [Phase 0 Foundation Plan](../plans/phase-0-foundation.zh-CN.md)
- [Phase 1 MVP Agent Loop Plan](../plans/phase-1-mvp-agent-loop.zh-CN.md)

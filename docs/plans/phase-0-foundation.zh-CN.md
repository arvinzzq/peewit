# Phase 0 Foundation Plan

状态：活跃
日期：2026-05-11

English version: [phase-0-foundation.md](./phase-0-foundation.md)

## Progress

状态：Complete

已完成：

- TypeScript workspace 和 pnpm workspace setup：`59c3064`、`6a36343`
- Apps 和 packages 的 package boundaries：`2df365e`
- 带 help、version 和 chat placeholder 的 CLI command shell：`7e499a4`
- 带 defaults、env overrides、validation 和 redaction 的 initial config loader：`5794556`
- 针对 links、bilingual headings、module guides 和 source headers 的 documentation checks：`0703b1d`、`b63eb5b`
- Root README 和 documentation maintenance policy：`54690fe`、`f1ec4e2`

最新验证：

- `pnpm run check`
- `pnpm run cli --help`
- `pnpm run cli chat`

Phase 0 视为完成。后续 foundation changes 应作为单独 maintenance decisions，或记录到需要它们的 phase 中。

## 1. 目的

Phase 0 在第一个可工作的 Agent loop 之前创建项目基础。

目标不是构建完整 Agent。目标是创建 TypeScript workspace、package boundaries、CLI shell、configuration foundation、documentation structure 和 test harness，让 Phase 1 更顺畅。

## 2. 用户结果

Phase 0 完成后，用户应该可以：

- 检查 repository structure。
- 运行基础 project checks。
- 运行 CLI help command。
- 看到 configuration 将放在哪里。
- 阅读 roadmap 和 architecture docs。

## 3. 范围

Phase 0 包括：

- 轻量 TypeScript workspace setup。
- `apps/cli` package shell。
- Core package directories。
- `packages/config` initial loader shape。
- Test runner setup。
- Documentation index 和 roadmap cleanup。
- Root README。

Phase 0 不包括：

- 真实 model calls。
- 完整 agent loop。
- Tool execution。
- Long-term memory。
- Web UI。

## 4. 计划工作

推荐顺序：

1. 创建 package 和 app directories。
2. 添加 workspace package configuration。
3. 添加 TypeScript configuration。
4. 添加 test runner configuration。
5. 添加带 `--help` 和 `--version` 的最小 CLI entry。
6. 添加 config package skeleton，包含 defaults 和 redacted view。
7. 添加 root README。
8. 在可行时添加 bilingual headings 和 links 的 documentation checks。

每一步在形成一个连贯结果时都应单独提交。

## 5. 建议目录结果

```text
apps/
  cli/
packages/
  config/
  core/
  context/
  models/
  tools/
  permissions/
  skills/
  sessions/
docs/
  architecture/
  decisions/
  plans/
  research/
  roadmap/
  product/
skills/
```

## 6. Package Boundaries

Phase 0 应创建边界，而不是完整行为。

预期初始 packages：

- `apps/cli`：command entry 和 terminal adapter shell。
- `packages/config`：configuration defaults、loading shape、redacted output。
- `packages/core`：minimal runtime package boundary。
- `packages/context`：minimal context package boundary。
- `packages/models`：minimal provider package boundary。
- `packages/tools`：minimal tool package boundary。
- `packages/permissions`：minimal permission package boundary。
- `packages/skills`：minimal skill package boundary。
- `packages/sessions`：minimal session package boundary。

Minimal packages 只应在对测试有用时包含 exports。

## 7. CLI Shell

Phase 0 CLI 行为：

- `vole --help` 显示可用命令。
- `vole --version` 显示 package version。
- 如果 Phase 1 尚未开始，`vole chat` 可以打印友好的 not-yet-implemented message，或启动 stub shell。

CLI shell 不能包含 prompt assembly、model calls、tool execution 或 permission decisions。

## 8. Configuration Foundation

Phase 0 config work 应支持：

- Built-in defaults。
- User config path concept。
- Project config path concept。
- Environment override concept。
- Redacted config view。
- 对明显无效值给出清晰 validation errors。

它不需要包含所有未来 config fields。

## 9. 测试

Phase 0 必需测试：

- CLI help 可以成功渲染。
- CLI version 可以成功渲染。
- Config defaults 可以加载。
- Config redaction 隐藏 secret-like values。
- Invalid config shape 产生有用错误。
- Package boundaries 不从 `apps/cli` 导入。
- Documentation bilingual heading check 通过。

Phase 0 中任何测试都不应调用真实 LLM provider。

## 10. 验证命令

具体命令取决于选择的工具，但 Phase 0 应以等价于以下内容的检查结束：

```text
install dependencies
typecheck
run tests
run documentation checks
run CLI help
```

最终 implementation commit 应记录哪些命令通过。

## 11. Commit Plan

建议小粒度 commits：

1. `chore: initialize typescript workspace`
2. `chore: add package boundaries`
3. `feat(cli): add command shell`
4. `feat(config): add initial config loader`
5. `test: add foundation checks`
6. `docs: add root project readme`

具体 commit messages 可以变化，但每个 commit 都应易于 review 和 revert。

## 12. 验收标准

Phase 0 完成标准：

- 约定目录结构存在。
- 项目可以安装 dependencies。
- TypeScript configuration 存在。
- Test runner 已配置。
- CLI help 和 version commands 工作。
- Config package 有经过测试的 initial shape。
- Documentation index 和 roadmap 一致。
- 没有实现依赖真实 model call。

## 13. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Project Structure](../architecture/project-structure.zh-CN.md)
- [Configuration System](../architecture/configuration-system.zh-CN.md)
- [Runtime Composition](../architecture/runtime-composition.zh-CN.md)
- [Testing Strategy](../architecture/testing-strategy.zh-CN.md)
- [Architecture Contracts](../architecture/contracts.zh-CN.md)

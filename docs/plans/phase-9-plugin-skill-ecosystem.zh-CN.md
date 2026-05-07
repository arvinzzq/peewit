# Phase 9：Plugin 和 Skill 生态

状态：完成
日期：2026-05-05

English version: [phase-9-plugin-skill-ecosystem.md](./phase-9-plugin-skill-ecosystem.md)

## 1. 概述

Phase 9 将 skill 系统从只读加载器扩展为受管理的生态，用户可以安装、启用、禁用和审查 skills，并完整了解 metadata、permissions 和 trust 状态。

本 Phase 采用文档优先方式：设计文档在实现开始前提交。

## 2. Commit 顺序

| Part | Commit | 内容 |
| --- | --- | --- |
| A | `docs: add Phase 9 design — plugin and skill ecosystem` (3ba04a5) | 本计划、plugin-system.md、skill-permissions.md、roadmap 更新 |
| B | `feat(skills): add extended metadata, SkillManager install/enable/disable/trust` (305c7fd) | packages/skills 更新，含 SkillManager、扩展 SkillDefinition、测试、文档 |
| C | `feat(cli): add skills install, enable, disable, trust, review subcommands` (5f68eac) | apps/cli skills 子命令、测试、文档 |
| D | `docs: mark Phase 9 complete` | Roadmap 和 plan 状态更新 |

## 3. Part A — 设计文档

创建双语设计文档：

- `docs/plans/phase-9-plugin-skill-ecosystem.md` + zh-CN（本文件）
- `docs/architecture/plugin-system.md` + zh-CN
- `docs/architecture/skill-permissions.md` + zh-CN

更新 roadmap：Phase 9 → In Progress。

## 4. Part B — 扩展 Skill Metadata

扩展 `packages/skills/src/index.ts`：

1. 向 `SkillDefinition` 添加可选字段：`version`、`origin`、`permissions`、`trusted`、`enabled`、`filePath`。
2. 更新 `parseSKILLMd()` 以解析新的 frontmatter 字段。
3. 更新 `SkillLoader.load()`，跳过已禁用的 skills，并标记未信任的用户 skills。
4. 添加 `SkillManifestEntry`、`SkillManifest` 类型。
5. 添加 `SkillManager` 类，包含 `install`、`enable`、`disable`、`trust`、`review`、`listEntries`。

更新测试、README、AGENTS 文档和 source header。

## 5. Part C — CLI Skill 子命令

在 `apps/cli/src/index.ts` 中添加：

- `vole skills` — 列出所有 skills，含 version、trust 状态、permissions
- `vole skills install <path>` — 从本地 .md 文件安装
- `vole skills enable <name>` — 启用已禁用的 skill
- `vole skills disable <name>` — 禁用已启用的 skill
- `vole skills trust <name>` — 标记为 trusted
- `vole skills review <name>` — 展示完整 metadata

所有子命令使用来自 `@vole/skills` 的 `SkillManager`。
用户 skills 目录作为 sessions 目录的同级目录推导得出。

## 6. Part D — 标记完成

更新 plan 和 roadmap 为 Complete，包含 commit hashes。

## 7. 验收标准

- Installed skills 可以列出和禁用。
- Permission declarations 在使用前可见。
- Third-party skills 不能静默获得 tool permissions。
- Version 和 source metadata 被记录。
- `vole skills trust <name>` 将 skill 标记为 trusted。
- 未信任的用户 skills 在所有列表命令中显示警告。

## 8. 非目标

- 暂不运营 public marketplace。
- 暂不自动信任 third-party skills。
- 暂不支持从 URL 远程安装。
- 暂不做 skill 签名验证。
- 暂不对 skill 文本进行沙箱隔离。

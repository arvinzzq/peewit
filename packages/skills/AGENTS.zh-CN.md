# Skills Agent Guide

## Responsibility

把 skill discovery、SKILL.md 解析、优先级逻辑、内置技能、summary projection 和 Phase 9 skill 生命周期管理保持在这里。这个 package 向调用方提供 SkillDefinition（完整，含扩展 metadata）、SkillSummary（紧凑）、SkillManifest、SkillManifestEntry 和 SkillManager。Context assembly 消费紧凑 summaries；CLI 展示使用完整 definitions；CLI 命令使用 SkillManager 进行生命周期操作。

## When Files Change

当 skill loading locations、内置技能、SKILL.md 格式、manifest 格式、SkillManager API 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Discovery order、重名 skills 的优先级规则、SKILL.md 解析（含扩展 frontmatter 字段）、基于 manifest 的 disabled/trusted 过滤、SkillManager install/enable/disable/trust/review/listEntries、缺失或格式错误文件的容错处理、内置技能存在性，以及 summary projection 都需要测试。

## Boundaries

不要在这里调用 model providers、执行 tools、读取 secrets 或决定 context section 包含逻辑。技能内容引导行为，它不执行操作也不授予权限。trusted 标志是建议性的 —— 实际工具 permission 决策由 @vole/permissions 做出。

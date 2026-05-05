# Skills Package

## Architecture Summary

这个目录拥有 local skill discovery、prompt integration 和 Phase 9 skill 生命周期管理。
它按优先级顺序从 workspace、user 和 built-in 位置加载 `SKILL.md` 文件。
用户 skills 通过 `~/.arvinclaw/skills/skills-index.json`（manifest）追踪，记录安装时间、trust 状态和 enabled 状态。
它导出用于 context injection 的紧凑 `SkillSummary` 和用于 CLI 展示的完整 `SkillDefinition`。
`SkillManager` 提供 install、enable、disable、trust、review 和 listEntries 操作。
内置技能（research、project-inspector、safe-shell）始终受信任且默认可用。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 skills package 和 exports。 |
| `tsconfig.json` | TypeScript config | 构建 skills package。 |
| `src/index.ts` | Skill system | 导出 SkillDefinition（含 version、origin、permissions、trusted、enabled、filePath）、SkillSummary、SkillManifest、SkillManifestEntry、支持优先级加载和 manifest-aware 用户 skill 过滤的 SkillLoader、用于 install/enable/disable/trust 生命周期的 SkillManager、parseSKILLMd（逗号分隔和 YAML 数组 permissions）和 toSkillSummary。 |
| `src/index.test.ts` | Skill tests | 保护包含扩展 frontmatter 字段的 SKILL.md 解析、workspace/user/built-in 加载、优先级规则、基于 manifest 的 disabled/trusted 过滤、SkillManager install/enable/disable/trust/review/listEntries、缺失或无效文件的容错处理，以及 summary 投影。 |

## Update Reminder

目录结构变化时更新此文件。

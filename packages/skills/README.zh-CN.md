# Skills Package

## Architecture Summary

这个目录拥有 local skill discovery 和 prompt integration。
它按优先级顺序从 workspace、user 和 built-in 位置加载 `SKILL.md` 文件。
它导出用于 context injection 的紧凑 `SkillSummary` 和用于 CLI 展示的完整 `SkillDefinition`。
内置技能（research、project-inspector、safe-shell）默认可用。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 skills package 和 exports。 |
| `tsconfig.json` | TypeScript config | 构建 skills package。 |
| `src/index.ts` | Skill system | 导出 SkillDefinition、SkillSummary、支持优先级加载和可注入文件系统操作的 SkillLoader、parseSKILLMd、toSkillSummary 和内置技能。 |
| `src/index.test.ts` | Skill tests | 保护 SKILL.md 解析、workspace/user/built-in 加载、优先级规则、缺失或无效文件的容错处理，以及 summary 投影。 |

## Update Reminder

目录结构变化时更新此文件。

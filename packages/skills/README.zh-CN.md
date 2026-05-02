# Skills Package

## Architecture Summary

这个目录保留 local skill discovery boundary。
它将读取并总结 `SKILL.md` files，用于 prompt integration。
它让 skill loading 与 prompt assembly 和 runtime orchestration 分离。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 skills package 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 skills package。 |
| `src/index.ts` | Package boundary | 导出当前 package marker 和未来 skill API surface。 |

## Update Reminder

目录结构变化时更新此文件。

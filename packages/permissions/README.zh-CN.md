# Permissions Package

## Architecture Summary

这个目录保留 permission policy boundary。
它将按风险分类 tool 和 runtime actions。
它将决定 allow、ask、deny 或 block，但不拥有用户界面。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 permissions package 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 permissions package。 |
| `src/index.ts` | Package boundary | 导出当前 package marker 和未来 permission API surface。 |

## Update Reminder

目录结构变化时更新此文件。

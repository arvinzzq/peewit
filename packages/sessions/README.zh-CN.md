# Sessions Package

## Architecture Summary

这个目录保留 session persistence boundary。
它将存储 conversations、turns、traces 和未来 replay data。
它让 persistence 与 runtime orchestration 和 UI rendering 分离。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 sessions package 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 sessions package。 |
| `src/index.ts` | Package boundary | 导出当前 package marker 和未来 session API surface。 |

## Update Reminder

目录结构变化时更新此文件。

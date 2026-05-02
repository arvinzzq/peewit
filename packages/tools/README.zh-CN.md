# Tools Package

## Architecture Summary

这个目录保留 tool registry 和 execution boundary。
它将验证 inputs，并包装 file、shell 和 web capabilities 等 built-in tools。
它不能决定 permissions；permission policy 位于 `packages/permissions`。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 tools package 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 tools package。 |
| `src/index.ts` | Package boundary | 导出当前 package marker 和未来 tool API surface。 |

## Update Reminder

目录结构变化时更新此文件。

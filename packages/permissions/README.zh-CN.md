# Permissions Package

## Architecture Summary

这个目录拥有 permission policy boundary。
它按 risk 和 autonomy mode 分类 tool actions。
它决定 allow、ask 或 deny，但不拥有用户界面。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 permissions package、export entrypoint 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 permissions package。 |
| `src/index.ts` | Permission policy | 导出 autonomy/risk/decision contracts 和 default permission policy。 |
| `src/index.test.ts` | Permission tests | 保护 observe、confirm、auto 和 blocked-action decision behavior。 |

## Update Reminder

目录结构变化时更新此文件。

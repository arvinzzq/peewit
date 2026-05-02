# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它将 CLI-visible commands 接到 runtime 和 config dependencies，但不拥有 agent planning、prompt assembly、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name、build scripts 和 runtime/config package dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 config、core、context 和 models 的 references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令、运行 configured 和 fake interactive chat loops、保存 in-process trace events，并渲染 `/help`、`/trace`、`/config` 和 `/exit`。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、configured chat、fake-provider chat、compact trace rendering、`/trace`、`/config`、missing API key handling 和 unknown-command behavior。 |

## Update Reminder

目录结构变化时更新此文件。

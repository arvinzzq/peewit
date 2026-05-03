# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它将 CLI-visible commands 接到 runtime、config、workspace prompt loading 和 durable session/message/trace dependencies，但不拥有 agent planning、prompt assembly、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name、build scripts 和 runtime/config/session package dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 config、core、context 和 models 的 references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令、列出并恢复 stored sessions、把 workspace prompt files 接入 context assembly、运行 configured 和 fake interactive chat loops、持久化 JSONL messages/traces，并渲染 `/help`、`/trace`、包含 memory policy 的 `/config` 和 `/exit`。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、session listing/resume、workspace prompt handoff、configured chat、durable message/trace handoff、short-term memory handoff、fake-provider chat、compact trace rendering、`/trace`、`/config` memory policy output、missing API key handling 和 unknown-command behavior。 |

## Update Reminder

目录结构变化时更新此文件。

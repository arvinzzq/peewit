# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它将 CLI-visible commands 和 approval prompts 接到 runtime、config、workspace prompt 和 read-only long-term/daily memory loading，以及 durable session/message/trace dependencies，但不拥有 agent planning、prompt assembly、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name、build scripts 和 runtime/config/session package dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 config、core、context 和 models 的 references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令、列出并恢复 stored sessions、把 workspace prompt files 和 read-only long-term/daily memory files 接入 context assembly、运行 configured 和 fake interactive chat loops、为 ask-level tool approvals 显示提示、持久化 JSONL messages/traces，并渲染 `/help`、`/trace`、包含 memory policy 的 `/config`、permission trace labels 和 `/exit`。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、session listing/resume、workspace prompt and long-term/daily memory handoff、configured chat、durable message/trace handoff、short-term memory handoff、fake-provider chat、ask-level approval prompts、compact tool and permission trace rendering、`/trace`、`/config` memory policy output、missing API key handling 和 unknown-command behavior。 |

## Update Reminder

目录结构变化时更新此文件。

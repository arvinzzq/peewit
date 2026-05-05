# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它将 CLI-visible commands、built-in file tools 和 approval prompts 接到 runtime，通过 runtime resolver 回传 approval decisions，配置 workspace prompt 和 read-only long-term/daily memory loading，并管理 durable session/message/trace dependencies，但不拥有 agent planning、prompt assembly、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name、build scripts 和 runtime/config/session/tool package dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 config、core、context、models 和 tools 的 references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令、列出并恢复 stored sessions、加载 skills、接入 workspace prompt/memory 文件、注册 built-in tools、运行 configured/fake interactive loops、resolve approvals、持久化 JSONL sessions/traces、展示 todos 进度，并导出带 `sendMessage(opts.onEvent)` 和 `CreateChatSessionOptions`（approvalResolver、preferStreaming）的 `CliChatSession`。真实交互聊天通过动态导入路由到 `src/app.tsx`。 |
| `src/app.tsx` | Ink 聊天应用 | 完整的 Ink 聊天 UI：`ChatApp` 组件含流式文本（`token_delta`）、工具进度 Spinner、审批提示、Todos 面板和 `useInput` 文本输入。`runInkChat()` 入口由 `main()` 调用，Session 在组件内创建并注入 Ink 审批 Resolver。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、session listing/resume、workspace prompt and long-term/daily memory handoff、configured chat、durable message/trace handoff、short-term memory handoff、fake-provider chat、built-in file and web tool execution、ask-level approval prompts、compact tool lifecycle and permission trace rendering、`/trace`、`/config` memory policy output、missing API key handling 和 unknown-command behavior。 |

## Update Reminder

目录结构变化时更新此文件。

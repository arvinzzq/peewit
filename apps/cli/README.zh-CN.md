# CLI App

## Architecture Summary

这个目录拥有命令行入口。
它围绕共享 runtime packages 适配终端输入和输出。
它将 CLI-visible commands、built-in file tools 和 approval prompts 接到 runtime，通过 runtime resolver 回传 approval decisions，配置 workspace prompt 和 read-only long-term/daily memory loading，并管理 durable session/message/trace dependencies，但不拥有 agent planning、prompt assembly、tools 或 permission policy。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 CLI package、executable name、build scripts 和 runtime/config/session/skill/tool/scheduler/gateway/adapters package dependencies。 |
| `tsconfig.json` | TypeScript config | 使用对 adapters、config、core、context、gateway、models、scheduler、skills 和 tools 的 references 构建 CLI package。 |
| `src/index.ts` | CLI adapter | 解析命令、列出并恢复 stored sessions、加载 skills、接入 workspace prompt/memory 文件（含 TOOLS.md、IDENTITY.md、HEARTBEAT.md、BOOTSTRAP.md）、注册含 `spawn_subagent` 的 built-in tools、运行 configured/fake interactive loops、resolve approvals、持久化 JSONL sessions/traces、展示 todos 进度、运行一次性后台任务（`run` 命令）、列出 task run 历史（`tasks` 命令）、提供 skills 子命令（`skills install/enable/disable/trust/review`，由 SkillManager 支持）、运行任务调度 Daemon（`daemon` 和 `daemon --once` 命令，从 tasks 目录加载 `*.task.json` 文件并通过 `CronScheduler` 执行 cron 计划任务）、在模块级 `SessionGateway` 单例中注册 CLI sessions、在 `close()` 时注销，并导出带 `sendMessage(opts.onEvent)` 和 `CreateChatSessionOptions`（approvalResolver、preferStreaming）的 `CliChatSession`。真实交互聊天通过动态导入路由到 `src/app.tsx`。 |
| `src/app.tsx` | Ink 聊天应用 | 完整的 Ink 聊天 UI：`ChatApp` 组件含流式文本（`token_delta`）、工具进度 Spinner、审批提示、Todos 面板和 `useInput` 文本输入。`runInkChat()` 入口由 `main()` 调用，Session 在组件内创建并注入 Ink 审批 Resolver。 |
| `src/index.test.ts` | CLI tests | 保护 help、version、session listing/resume、workspace prompt and long-term/daily memory handoff、TOOLS.md 及其他 workspace 文件加载、缺失 workspace 文件的优雅跳过、configured chat、durable message/trace handoff、short-term memory handoff、fake-provider chat、built-in file and web tool execution、ask-level approval prompts、compact tool lifecycle and permission trace rendering、`/trace`、`/config` memory policy output、missing API key handling、unknown-command behavior、skills install/disable/trust/review 子命令，以及 daemon 缺失 API key、缺失 tasks 目录、cron 任务执行和非 cron 任务跳过。 |

## Update Reminder

目录结构变化时更新此文件。

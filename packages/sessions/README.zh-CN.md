# Sessions Package

## Architecture Summary

这个目录保留 session persistence boundary。
它存储 short-term conversation records、durable JSONL sessions，并为 durable traces 和未来 replay data 做准备。
它让 persistence 与 runtime orchestration 和 UI rendering 分离。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 sessions package、package exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 sessions package。 |
| `src/index.ts` | Session store | 导出 session/message contracts，以及 in-memory 和 JSONL session storage。 |
| `src/index.test.ts` | Session tests | 保护 session creation、message ordering、recent-message queries、defensive copies、JSONL replay 和 unsafe session ID rejection。 |

## Update Reminder

目录结构变化时更新此文件。

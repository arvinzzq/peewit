# Sessions Package

## Architecture Summary

这个目录负责 session persistence boundary。
它存储 short-term conversation records、durable JSONL sessions、durable trace events，并为未来 replay data 做准备。
它让 persistence 与 runtime orchestration 和 UI rendering 分离。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 sessions package、package exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 sessions package。 |
| `src/index.ts` | Session store | 导出 session、message 和 trace contracts，以及带 session listing 的 in-memory 和 JSONL session storage。 |
| `src/index.test.ts` | Session tests | 保护 session creation、session listing order、message ordering、trace persistence、recent queries、defensive copies、JSONL replay 和 unsafe session ID rejection。 |

## Update Reminder

目录结构变化时更新此文件。

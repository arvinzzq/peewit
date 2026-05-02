# Config Package

## Architecture Summary

这个目录拥有 configuration loading 和 validation。
它合并 defaults、user config、project config 和 environment overrides。
它在 configuration 显示到 traces 或 CLI output 前保持 secrets redacted。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 config package 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 config package。 |
| `src/index.ts` | Config loader | 导出 config types、defaults、merge logic、validation 和 redaction。 |
| `src/index.test.ts` | Config tests | 保护 defaults、precedence、env overrides、redaction 和 validation errors。 |

## Update Reminder

目录结构变化时更新此文件。

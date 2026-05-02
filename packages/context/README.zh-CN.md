# Context Package

## Architecture Summary

这个目录拥有 provider-neutral context assembly。
它决定如何从 system instructions、runtime metadata 和 user input 构建 model messages。
它为未来 workspace files、memory、skills、tools 和 compaction 准备路径。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 context package exports 和对 models 的依赖。 |
| `tsconfig.json` | TypeScript config | 使用对 models 的 reference 构建 context。 |
| `src/index.ts` | Context assembler | 导出 context assembly contracts 和 default assembler。 |
| `src/index.test.ts` | Context tests | 保护 deterministic message ordering 和 assembly reports。 |

## Update Reminder

目录结构变化时更新此文件。

# Tools Package

## Architecture Summary

这个目录拥有 tool registry 和 execution boundary。
它定义 tool metadata、验证 inputs、归一化 results，并包装 file、shell 和 web capabilities 等 built-in tools。
它不能决定 permissions；permission policy 位于 `packages/permissions`。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 tools package、export entrypoint 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 tools package。 |
| `src/index.ts` | Tool registry and built-in tools | 导出 tool definition contracts、executable tool contracts、risk metadata、registry lookup/listing behavior、read-only file tools、guarded write_file tool、guarded shell tool、normalized tool results 和 registry errors。 |
| `src/index.test.ts` | Tool tests | 保护 registry lookup、deterministic listing、defensive copies、duplicate registration errors、read-only and write_file tools、shell tool execution、workspace boundaries、secret file blocking、blocked command patterns、timeout handling 和 normalized failures。 |

## Update Reminder

目录结构变化时更新此文件。

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
| `src/index.ts` | Tool registry and built-in tools | 导出 tool definition contracts、executable tool contracts、risk metadata、registry lookup/listing behavior、read-only file tools、guarded write_file tool、guarded shell tool、read_web_page tool、`update_todos` 任务追踪 tool、`append_daily_memory` tool、`load_skill` 按需 skill loader、`memory_search` 和 `memory_get` agent 记忆检索 tools、`createMemorySearchTool` 和 `createMemoryGetTool` factories、`createLoadSkillTool` factory、`SkillFileMap` 类型、`LoadSkillResult` 类型、`MemorySearchResult` 类型、`MemoryGetResult` 类型、`TodoItem` 类型、用于 sub-agent tool 结果的 `SpawnSubagentResult` 类型、normalized tool results 和 registry errors。 |
| `src/index.test.ts` | Tool tests | 保护 registry lookup、deterministic listing、defensive copies、duplicate registration errors、read-only and write_file tools、shell tool execution、web page fetching and HTML extraction、workspace boundaries、secret file blocking、blocked command patterns、timeout handling、HTTP and network errors、normalized failures、`update_todos` 验证和 callback 行为，以及 `load_skill` file map 解析、unknown skill errors 和 unreadable file errors，以及 `memory_search` 和 `memory_get` tools，包括 path validation、case-insensitive search、maxResults limiting 和 directory traversal rejection。 |

## Update Reminder

目录结构变化时更新此文件。

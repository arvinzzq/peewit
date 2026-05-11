# Memory Agent Guide

## 职责

工作区记忆层：读 MEMORY.md / USER.md / memory/YYYY-MM-DD.md，写今天的日记。导出模型可调工具 `memory_search`、`memory_get`、`append_daily_memory`。Phase 13 Step 3 会加入 `EmbeddingProvider` 接口与混合检索。

## 文件变更时

当记忆工具表面或文件清单变化时更新 README 与 AGENTS。当 inputs、outputs 或 system position 变化时更新 `src/index.ts` 头。EN 与 zh-CN 之间的 heading 对等必须保持。

## 测试

记忆测试必须覆盖：append（成功 + 拒空 + 多次追加 + 目录自动创建）、search（无 memory 目录、MEMORY.md 命中、USER.md 命中、日记命中、大小写不敏感、maxResults 限制）、get（合法 + 缺失 + 穿越 + 绝对 + 非 md 拒绝）。使用真实临时目录（`mkdtemp`）；从不 mock `node:fs/promises`。

## 边界

不要在此 import `@vole/core`、`@vole/sessions` 或任何运行时层。Memory 是工具集叶子，与 `@vole/tools` 并列。工具结果类型接口（`MemorySearchResult`、`MemoryGetResult`、`AppendDailyMemoryResult`、`ToolExecutionFailure`）仍住在 `@vole/tools`，让 `ToolExecutionResult` 判别联合保持单一来源；本 package 从中 import。

不要做属于别处的工作：prompt 装配在 `@vole/context`、压缩在 `@vole/context`、dreaming 编排在 `@vole/scheduler` / `apps/cli`。本 package 只是读写层。

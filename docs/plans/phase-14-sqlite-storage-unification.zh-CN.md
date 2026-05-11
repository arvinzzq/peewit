# Phase 14：SQLite 存储统一升级

状态：已完成（全部 8 步已交付 —— Step 5、6、7 落在 Phase 14b）
日期：2026-05-12

English version: [phase-14-sqlite-storage-unification.md](./phase-14-sqlite-storage-unification.md)

## 进度

状态：已完成 —— 每个持久化 store 都有了 SQLite 实现，迁移命令就位，FTS5 记忆索引与启动迁移提示也已落地。

已完成提交：

- [x] Step 1：docs(arch) session-storage 与 task-flow 的 Phase 14 提示 — `2d0d0f2`
- [x] Step 2 + 3：feat(sessions) better-sqlite3 + 带 WAL 的 SqliteSessionStore — `0c72269`
- [x] Step 4：feat(taskflow) SqliteTaskFlowStore，drainPendingForParent 单事务实现 — `c83edd8`
- [x] Step 5（14b）：feat(memory) SqliteMemoryIndex（FTS5）— `d59a47a`
- [x] Step 6（14b）：feat(sessions,taskflow,cli) `vole migrate jsonl-to-sqlite`（dry-run + --apply）；DDL 抽出为 `SQLITE_SESSIONS_SCHEMA_SQL` / `SQLITE_TASKFLOW_SCHEMA_SQL` — `df041e6`
- [x] Step 7（14b）：feat(cli) `vole chat` 启动时的迁移提示 — `eef638f`
- [x] Step 8：docs 标记 Phase 14 完成 + roadmap 更新 — （本次提交）

今天可用：

- 在测试代码或未来 adapter 中直接 `new SqliteSessionStore({ databasePath })` 或 `new SqliteTaskFlowStore({ databasePath })`。
- 两个 store 满足与 JSONL 完全相同的接口契约；gateway / CLI 可通过未来的 `storage.backend` 配置开关切换 backend，消费者无需改动。
- 从现有 JSONL 数据迁移的路径在 Phase 14b；目前 SQLite store 从空数据库起步。

## 1. 目的

Phase 14 把 Vole 所有持久化存储从 JSONL 迁移到 SQLite。Sessions、TaskFlow 记录、Phase 13 引入的记忆索引目前都用追加式 JSONL，几千条以内可用，再多就扛不住。OpenClaw 全栈 SQLite；在此对齐能解锁快速列表查询、索引化检索、FTS5 支持的记忆搜索，以及原子的多记录更新。

本 phase 依赖 Phase 11（gateway 与 lane）所提供的跨进程安全保证以共享 SQLite 文件。可选依赖 Phase 13 提供的 memory package，由本 phase 完成其索引迁移。

## 2. 范围

本 phase 包含：

- 加入 `better-sqlite3` 依赖；同步 API 与预编译二进制，安装路径干净。
- `packages/sessions` 中的 `SqliteSessionStore`，完全兼容 `SessionStore` 接口；`JsonlSessionStore` 保留用于 fallback 与测试。
- `packages/taskflow` 中的 `SqliteTaskFlowStore`，对 `status`、`parentId`、`runtime`、`createdAt` 建索引。
- `packages/memory` 中的 SQLite 记忆索引：FTS5 用于关键词；blob 列存向量；可选 `sqlite-vec` 扩展（可用时启用）。
- `vole migrate jsonl-to-sqlite` 命令，用于现有数据的一次性转换。
- 启动检测：当存在 JSONL 但无 SQLite 时，打印一次提示建议迁移。
- Schema 版本：极简的 `schema_version` 表，未来迁移可读取。
- 更新模块文档（`packages/sessions`、`packages/taskflow`、`packages/memory`），把 SQLite 标为默认。

本 phase 不包含：

- PostgreSQL 或远程数据库支持。
- 分片或复制。
- 完整的 schema migration 框架（单步版本提升即可）。
- 从代码库中完全移除 JSONL 实现（仍保留供测试与紧急导出）。

## 3. 架构摘要

### SQLite 后端选型

选 `better-sqlite3` 而非 `node:sqlite` 或 `sqlite3`：

- 同步 API 与现有 store 接口匹配，无需别扭的 async 包装。
- 预编译二进制覆盖 macOS / Linux / Windows，用户无需 node-gyp 折腾。
- 强 WAL 支持配合我们的跨进程文件锁。
- 活跃维护，性能特性稳定。

所有 store 用 `journal_mode=WAL` 与 `synchronous=NORMAL` 打开数据库。读不阻塞写。

### Schema 与索引

`<sessionsDir>/` 下三个数据库：

- `sessions.sqlite`：表 `sessions(id PK, agentId, sessionKey UNIQUE, lastActivityAt, ...)`、`messages(id PK, sessionId FK, role, content, createdAt, ...)`，索引 `(sessionId, createdAt)` 与 `(agentId, lastActivityAt DESC)`。
- `taskflow.sqlite`：表 `task_records(id PK, runtime, status, parentId, terminalSummary, ...)`、`task_flows(id PK, ...)`，索引 `status`、`parentId`、`runtime`、`createdAt`。
- `memory-index.sqlite`：FTS5 虚拟表覆盖 `memory_chunks(file, paragraph, text)`，外加 `embeddings(chunkId, model, vector BLOB)`；除非加载 `sqlite-vec`，向量列由 JS 端点积查询。

外键加 `ON DELETE CASCADE`，保证清理正确。

### 迁移工具

`vole migrate jsonl-to-sqlite` 完成转换：

1. 如已存在任何 SQLite 文件，默认拒绝运行（用 `--force` 覆盖）。
2. 现有 JSONL 备份到 `<sessionsDir>/migrations/<timestamp>/`。
3. 流式读取 JSONL 记录，单文件单事务插入 SQLite。
4. 验证行数与文件行数一致；不一致则中止并从备份恢复。
5. 打印每张表的行数摘要。

`--dry-run` 标志显示会迁移什么但不写入。

### 向后兼容

在一个 minor 版本周期内，store 先尝试 SQLite，缺失则 fallback 到 JSONL。之后 reader 停止读 JSONL（除非通过迁移命令）。fallback 期让有 daemon 在跑的用户无需协调停机切换。

默认 store factory 由 `storage.backend` 配置选择（默认 `"sqlite"`）；测试可强制 `"jsonl"`。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`session-storage.md` 更新 + zh-CN、`task-flow.md` 更新 + zh-CN、`memory-system.md` 更新 + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **chore(deps)**：加入 `better-sqlite3`；在 CI 中验证跨平台安装。
3. **feat(sessions)**：`SqliteSessionStore` + 测试；两个 store 通过配置可选。
4. **feat(taskflow)**：`SqliteTaskFlowStore` + 测试。
5. **feat(memory)**：带 FTS5 与 embedding blob 的 SQLite 记忆索引；从 Phase 13 的 JSONL 索引透明切换；测试。
6. **feat(cli)**：`vole migrate jsonl-to-sqlite` 命令，含 `--dry-run` 与 `--force`。
7. **feat(cli)**：启动时迁移提示。
8. **docs**：标记 Phase 14 完成。

## 5. 验收标准

- 每次提交都通过 `pnpm run check` 与 `pnpm run check:bundle`。
- 合成 10000 session 列表基准用 SQLite 在 50 ms 内加载（比 JSONL 基线快若干数量级）。
- 往返测试：取现有 JSONL，运行 `vole migrate jsonl-to-sqlite`，再读回应完全一致。
- 迁移备份能创建并可恢复。
- 跨进程测试：两个 `vole` 进程在 WAL 下追加同一份 SQLite store；无写入丢失。
- 带 FTS5 的记忆搜索能匹配关键词正则搜索漏掉的短语 query。
- 配置 `storage.backend: "jsonl"` 可端到端恢复 Phase 13 行为。

## 6. 非目标

- 不做 PostgreSQL。
- 不做远程 / 网络数据库。
- 不做 schema migration DSL —— 单步版本提升即可。
- 不做自动 vacuum 或压缩调度（手动 `vole storage vacuum` 是后续选项）。
- 不从代码库移除 JSONL store。

## 7. 相关文档

- [Phase 11 Gateway 与 Lane 基础设施](./phase-11-gateway-and-lanes.zh-CN.md)
- [Phase 13 记忆与提示增强](./phase-13-memory-and-prompt-enhancement.zh-CN.md)
- [Session Storage](../architecture/session-storage.zh-CN.md)
- [Task Flow](../architecture/task-flow.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

# Memory Package

English version: [README.md](./README.md)

## 架构概览

`@vole/memory` 拥有 **工作区记忆层**：读 `MEMORY.md`、`USER.md`、`memory/YYYY-MM-DD.md`；写今天的日记文件。它导出 agent 与邮箱交互所使用的三个模型可调工具：

```
agent runtime
    │  工具调用
    ▼
@vole/memory
    ├─ memory_search         （Phase 13 Step 3 起做混合检索，目前仅关键词）
    ├─ memory_get
    └─ append_daily_memory
```

Phase 13 Step 2 把该 package 从 `@vole/tools` 切出，让记忆相关关注点能独立演进。Step 3 会加入 `EmbeddingProvider` 接口与混合检索。Step 4 会加入 DREAMS.md 审阅流程。

## 核心概念

### memory_search

```ts
{ query: string; maxResults?: number }
  → { ok: true; results: Array<{ file: string; excerpt: string }>; total: number }
```

目前工具在 `MEMORY.md`、`USER.md` 与 `memory/` 下的所有文件上按段落做关键词匹配。Phase 13 Step 3 将加入基于 embedding 的向量检索，并通过 reciprocal rank fusion 与关键词路径融合；工具签名保持不变。

### memory_get

```ts
{ path: string }  // 必须以 .md 结尾且不出工作区
  → { ok: true; content?: string; error?: string }
```

按路径安全读取。拒绝 `..` 穿越、拒绝绝对路径、拒绝非 `.md` 文件。返回 `content` 或 `error`，形状相同 —— 模型不必 try/catch。

### append_daily_memory

```ts
{ content: string }
  → { ok: true; filePath: "memory/YYYY-MM-DD.md"; summary: string }
```

向今天的日记文件追加一个带 `## HH:MM` 时间戳的块。首次使用时创建 `memory/` 目录。空内容被拒绝并返回 `ok: false`。

### EmbeddingProvider（预留）

```ts
interface EmbeddingProvider {
  readonly name: "openai" | "voyage";
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

现在以前瞻类型导出。Phase 13 Step 3 加入两个适配并接线混合搜索。

## 实现原则

### 为什么独立 package

记忆有自己的路线图：混合检索、dreaming、审阅工作流、最终 SQLite + FTS5 存储。把它与文件系统和 shell 工具放在一起会让 `@vole/tools` 表面膨胀、拖慢重构。这次切分代价很小：结果类型仍住在 `@vole/tools`，作为 `ToolExecutionResult` 联合的一部分，由 `@vole/memory` 导入。

### 默认只读

`memory_search` 与 `memory_get` 是低风险读取路径。`append_daily_memory` 是唯一写入面，且写入按日期命名的文件，agent 不会意外覆盖 `MEMORY.md` 或 `USER.md` —— 这两个仍由用户自管 / curator 编辑。

### 路径安全

`memory_get` 在动文件系统之前验证输入：拒绝 `..` 穿越、拒绝绝对路径、要求 `.md` 后缀。最终解析路径必须留在 workspace 根目录之内。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 memory package，单一 workspace 依赖 `@vole/tools`（取结果类型）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 memory package；引用 `@vole/tools`。 |
| `src/index.ts` | 记忆工具 | 导出 `memoryPackageName`、`EmbeddingProvider`、`createMemorySearchTool`、`createMemoryGetTool`、`createAppendDailyMemoryTool`。 |
| `src/index.test.ts` | 记忆测试 | 从 `@vole/tools` 迁来。覆盖 append（成功 + 空内容 + 多次追加 + 目录创建）、search（空目录、MEMORY.md + USER.md + 日记命中、大小写不敏感、maxResults）、get（合法 + 缺失 + 穿越 + 绝对 + 非 md 拒绝）。 |

## 更新提醒

当目录结构或模块职责变化时更新本文件。

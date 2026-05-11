# Memory Package

English version: [README.md](./README.md)

## 架构概览

`@vole/memory` 拥有 **工作区记忆层**：读 `MEMORY.md`、`USER.md`、`memory/YYYY-MM-DD.md`；写今天的日记文件。它导出 agent 与邮箱交互所使用的三个模型可调工具：

```
agent runtime
    │  工具调用
    ▼
@vole/memory
    ├─ memory_search         （混合：提供 EmbeddingProvider 时走 vector + keyword via RRF；否则仅关键词）
    ├─ memory_get
    └─ append_daily_memory
```

Phase 13 Step 2 把该 package 从 `@vole/tools` 切出，让记忆相关关注点能独立演进。Phase 13b Step 3 接通了混合检索：`createMemorySearchTool(workspaceRoot, { embeddingProvider })` 会同时跑向量 top-K 与按段落关键词匹配，并用 reciprocal rank fusion（默认常数 k=60）融合两份排名。未提供 provider 时行为与之前的关键词基线一致。Provider 抛错时工具静默回退到关键词路径 —— 一次 embedding 故障不会阻塞 agent。`FakeEmbeddingProvider` 随包发布，用于单测与本地优雅降级；真正的 `openai` / `voyage` 适配实现同一接口，可直接替换调用点。

## 核心概念

### memory_search

```ts
{ query: string; maxResults?: number }
  → { ok: true; results: Array<{ file: string; excerpt: string }>; total: number }
```

按段落在 `MEMORY.md`、`USER.md` 与 `memory/` 下所有文件做关键词匹配是始终启用的路径。当 `createMemorySearchTool(workspaceRoot, { embeddingProvider })` 被传入 provider 时，工具还会对每段以及 query 做 embedding，按余弦相似度做 top-K（默认 10），**用 reciprocal rank fusion 把向量排名和关键词排名融合**（默认常数 k=60）。工具签名与纯关键词路径完全一致。Provider 抛错时静默回退到关键词路径 —— 一次 embedding 故障不会阻塞 agent。

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

### EmbeddingProvider

```ts
interface EmbeddingProvider {
  readonly name: "openai" | "voyage" | "fake";
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

`FakeEmbeddingProvider` 随包发布 —— 用 SHA-256 派生的 token-bag 向量，L2 归一。它是单测的安全默认值，也是没有真实 provider 时 agent 使用的实现。真正的 `openai` / `voyage` 适配实现同一接口，可直接替换调用点。

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
| `src/index.ts` | 记忆工具 + 混合检索 + DREAMS 工作流 | 导出 `memoryPackageName`、`EmbeddingProvider`、`EmbeddingProviderName`、`FakeEmbeddingProvider`、`MemorySearchToolOptions`、`createMemorySearchTool`、`createMemoryGetTool`、`createAppendDailyMemoryTool`，以及 Phase 13b Step 4 DREAMS.md 原语：`DreamEntry`、`DreamEntryStatus`、`parseDreamsFile`、`serializeDreamsFile`、`readDreamsFile`、`applyDreamDecision`。 |
| `src/index.test.ts` | 记忆测试 | 覆盖 append、关键词 search、混合 search（FakeEmbedding 确定性 + 正交、向量排序、provider 失败回退、RRF 融合）、get（合法 + 缺失 + 穿越 + 绝对 + 非 md），以及 DREAMS 工作流（parse、serialize round-trip、缺失文件返回空列表、approve 追加到 MEMORY.md、reject 归档到 DREAMS/archive/、未知 id 返回 undefined）。 |

## 更新提醒

当目录结构或模块职责变化时更新本文件。

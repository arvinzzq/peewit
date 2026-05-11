# Phase 13：记忆与提示增强

状态：已完成（全部 8 步都已交付 —— Step 3、4、5、6 落在 Phase 13b）
日期：2026-05-12

English version: [phase-13-memory-and-prompt-enhancement.md](./phase-13-memory-and-prompt-enhancement.md)

## 进度

状态：已完成 —— Phase 13b 关闭了所有遗留缺口。混合检索、DREAMS 工作流、silent flush、六段 prompt 全部落地。

已完成提交：

- [x] Step 1：docs(arch) 在 memory-system / context-compaction / prompt-assembly 加 Phase 13 提示 — `229a608`、`daa9e6c`
- [x] Step 2：feat(memory) 把记忆工具抽到 `@vole/memory`；预留 `EmbeddingProvider` 接口 — `1ef9cd8`
- [x] Step 3（13b）：feat(memory) 混合 `memory_search` + EmbeddingProvider + FakeEmbeddingProvider + reciprocal rank fusion — `c1cf437`
- [x] Step 4（13b）：feat(memory,cli) DREAMS.md 审阅工作流 —— parseDreamsFile、applyDreamDecision、`vole memory review` CLI — `b7fa52b`
- [x] Step 5（13b）：feat(core) 压缩前记忆 flush silent turn —— `memory_flush_triggered` 事件、静默 side-channel 模型调用 — `9d92f80`、`75ede20`
- [x] Step 6（13b）：feat(context) 六个新 system prompt section（Reasoning / Reply Tags / Documentation / Self-Update / Execution Bias / Current Date & Time）— `393d4e0`
- [x] Step 7：feat(context,cli) `parseInlineDirectives` + `vole compact` 说明命令 — `f2b84b9`
- [x] Step 8：docs 标 Phase 13 完成 + roadmap 更新 — （本次提交）

## 1. 目的

Phase 13 关闭第二轮审计中浮现的三个 OpenClaw 对齐缺口：仅关键词的记忆搜索、缺失的 DREAMS.md promotion 流程，以及缺少 Reasoning、Reply Tags、Documentation、Self-Update、Execution Bias、Current Date & Time 等 section 的不完整 system prompt。同时把 `/think:<level>`、`/stop`、`/compact` 等 inline 指令接入 intake。

Phase 13 与 Phase 11 的 gateway 工作基本独立，可与 Phase 12 并行。唯一例外是新的 `packages/memory` package，Phase 14 之后会把它移植到 SQLite + FTS5。

## 2. 范围

本 phase 包含：

- 从 `packages/tools` 拆出新的 `packages/memory`。
- `EmbeddingProvider` 接口，并自动检测 OpenAI 和 Voyage 凭证。
- 混合 `memory_search`：向量 top-K 加关键词 fallback，分数融合。
- `DREAMS.md` 工作流：dreaming 输出先写入 `DREAMS.md` 供人类审阅；只有用户通过 `vole memory review` 显式确认才提升至 `MEMORY.md`。
- 压缩前记忆 flush：在 `compactMessages` 运行前注入一条 silent system 回合，提醒 agent 落盘持久事实。
- system prompt 新增 section：`Reasoning`、`Reply Tags`、`Documentation`、`Self-Update`、`Execution Bias`、`Current Date & Time`。
- Intake 阶段的 inline 指令解析器：从用户消息中提取 `/think:<level>`、`/stop`、`/compact` 与 `NO_REPLY`，按运行时 hint 应用。
- `vole compact` CLI 命令（用户主动触发的上下文压缩）。

本 phase 不包含：

- OpenAI 与 Voyage 之外的 embedding 提供商（Gemini、Mistral 推迟）。
- SQLite 或 FTS5（Phase 14 替换内存索引）。
- Memory-core 插件接口（推迟到 Phase 16，与更广义的插件运行时一起）。
- 每个 agent 独立的记忆隔离（Phase 15）。

## 3. 架构摘要

### 混合记忆搜索

`memory_search` 升级为混合检索：

1. 在 `MEMORY.md`、`USER.md`、`memory/*.md` 上构建 / 刷新 per-workspace 向量索引。索引位于 `<sessionsDir>/../memory-index/`。
2. 查询时：嵌入 query、跑向量 top-K（默认 K=10）、同时跑关键词段落搜索。
3. 用 reciprocal rank fusion 融合分数；返回 top N（默认 5）。
4. 若未配置 embedding 提供商，静默 fallback 到关键词模式。

`EmbeddingProvider` 接口保持精简：

```ts
interface EmbeddingProvider {
  name: "openai" | "voyage";
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

索引在 Phase 13 用 JSONL 加二进制 `.vec` 旁车文件；Phase 14 透明替换为 SQLite + FTS5 + vec 扩展。

### DREAMS.md 与 Promotion

Dreaming 从"重写 MEMORY.md"改为两步流程：

1. `vole run --dream` 读取近期 `memory/YYYY-MM-DD.md` 文件与当前 `MEMORY.md`，把候选摘要写入 `DREAMS.md`。每条按频率、召回多样性、新近度评分。
2. 用户执行 `vole memory review`（或打开 `DREAMS.md`）批准或拒绝 promotion。被批准的条目追加到 `MEMORY.md`；拒绝的归档到 `DREAMS/archive/`。

恢复 OpenClaw 文档中描述的可审阅性，且永不绕过用户同意。

### 压缩前记忆 flush

在 `compactMessages` 运行前，runtime 注入一条 silent system 回合：

> "Before this conversation is compressed, write any durable facts the user will care about across sessions to MEMORY.md via `append_daily_memory`."

模型获得一回合机会去行动。本回合中的工具调用计入正常步数限制，但不向用户发出 `assistant_message_created`。若用户禁用了长期记忆写入，则跳过 flush。

通过 `compaction.memoryFlush.enabled` 配置（默认 true）。

### Prompt section 补齐与 inline 指令

`ContextAssembler` 增加六个新的 section builder。默认顺序对齐 OpenClaw：

```text
identity → runtime → current-date → tooling → execution-bias → safety
  → reasoning → reply-tags → skills → workspace → documentation
  → self-update → conversation-history → user-message
```

Inline 指令解析器在 intake 阶段运行（上下文装配之前）：

| Token | 效果 |
| --- | --- |
| `/think:<level>` | 设置 per-run `thinkingBudget` |
| `/stop` | 通过 `GatewayCore.cancel` 取消当前 run |
| `/compact` | 在下一回合前强制立即压缩 |
| `NO_REPLY`（assistant 输出） | 抑制子代理向父代理的 announce |

Token 在模型可见之前从用户消息中剥离。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`memory-system.md` 更新 + zh-CN、`context-compaction.md` 更新 + zh-CN、`prompt-assembly.md` 更新 + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **feat(memory)**：新 `packages/memory`；把记忆工具从 `packages/tools` 搬出，保留相同导出；测试。
3. **feat(memory)**：`EmbeddingProvider` + OpenAI + Voyage 适配；混合索引；更新后的 `memory_search`；测试。
4. **feat(scheduler,cli)**：`vole run --dream` 写入 `DREAMS.md`；`vole memory review` 命令。
5. **feat(core,context)**：压缩前记忆 flush silent turn。
6. **feat(context)**：六个新的 system prompt section。
7. **feat(core)**：inline 指令解析器；`vole compact` CLI 命令。
8. **docs**：标记 Phase 13 完成。

## 5. 验收标准

- 每次提交都通过 `pnpm run check`。
- 一个合成记忆语料测试验证：语义相关但无共享关键词的 query 能返回相关段落。
- 未配置 embedding 凭证时，`memory_search` 返回关键词结果且不报错。
- `vole run --dream` 产生 `DREAMS.md`；无新增内容时再次运行产生零新条目。
- `vole memory review` 列出待处理的 DREAMS 条目并接受批准 / 拒绝。
- 长对话测试显示压缩前 silent turn 触发，且模型响应中调用了 `append_daily_memory`。
- 检查 system prompt 显示全部 14 个 section 按文档顺序出现。
- 用户消息中包含 `/think:max` 时设置该 run 的 thinking 预算，且不泄漏给 assistant。

## 6. 非目标

- 不做 Gemini 或 Mistral embedding 适配。
- 不做 SQLite / FTS5 存储（Phase 14）。
- 不做 memory-core 插件接口（Phase 16）。
- 不做 per-agent 隔离的记忆目录。
- 不做 `MEMORY.md` 内容的语义去重。

## 7. 相关文档

- [Memory System](../architecture/memory-system.zh-CN.md)
- [Context Compaction](../architecture/context-compaction.zh-CN.md)
- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [OpenClaw 对齐计划](./openclaw-alignment.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

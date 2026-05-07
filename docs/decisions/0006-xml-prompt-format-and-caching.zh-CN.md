# Decision 0006 — XML Prompt 格式与 Prompt Caching

状态：已接受
日期：2026-05-04

English version: [0006-xml-prompt-format-and-caching.md](./0006-xml-prompt-format-and-caching.md)

## 背景

Vole 的 context assembler（Phase 3）产生基于 sections 的 system prompt。在回顾 OpenClaw 源码研究后，出现了两个问题：

1. Sections 应该用普通 Markdown 标题还是 XML tags 作为分隔符？
2. `AnthropicProvider` 是否应该利用 Anthropic 的 prompt caching API？

## 决策 1 — XML Section 格式

Sections 应使用 XML tags 作为分隔符。

Context assembler 输出示例：

```xml
<identity>
Vole 是一个受 OpenClaw 启发的个人通用 Agent...
</identity>

<safety>
Permission guidance：...
</safety>

<tooling>
可用 tools：read_file、list_directory、write_file、run_shell、read_web_page
</tooling>

<skills>
- research：调查外部信息或比较来源时使用。
</skills>
```

### 原因

Anthropic 模型经过训练，能识别 XML tags 作为结构化分隔符。使用 XML：

- 产生比 Markdown 标题更可靠的 section 边界识别。
- 能无歧义地把 section 意图与正文内容分开。
- 在测试中易于确定性解析。
- 遵循 Anthropic 官方推荐的复杂 system prompt 结构化方式。

### 考虑过的备选方案

**Markdown 标题（`## Identity`）**：熟悉且可读，但 Markdown 是正文内容的一部分，不是结构化分隔符。标题可以出现在 section 正文内部，作为 section 分隔符时存在歧义。

**普通分隔符（`---`）**：有类似歧义问题；分隔符会出现在 frontmatter、代码块和正文中。

**JSON**：机器可读，但混合正文和结构化内容时难以编写。

## 决策 2 — Prompt Caching

`AnthropicProvider` 应在 system content 上应用 `cache_control: { type: "ephemeral" }`。

Anthropic API 会将 system prompt 前缀缓存最多 5 分钟。同一 window 内的后续请求跳过对已缓存前缀的重新处理，降低成本和延迟。

### 实现方式

当 system content 是字符串时，provider 应将其作为带 `cache_control` 的单元素数组发送：

```typescript
system: [
  {
    type: "text",
    text: systemContent,
    cache_control: { type: "ephemeral" },
  },
],
```

### 对 Section 顺序的影响

为最大化缓存命中率，稳定 sections 必须在易变 sections 之前。推荐顺序：

1. `<identity>` — 安装后静态不变
2. `<safety>` — 仅在 config 变化时改变
3. `<tooling>` — 仅在 tool set 变化时改变
4. `<skills>` — 仅在 skill 文件变化时改变
5. `<workspace>` — 仅在 workspace 文件变化时改变
6. `<runtime>` — 包含当前日期/时间；每次 session 都变化

这种顺序把最稳定的内容放在最前面，让 Anthropic 可以缓存尽可能长的前缀。

### 考虑过的备选方案

**不缓存**：更简单，但在包含多次调用的长 system prompt 中浪费成本和延迟。Phase 3+ 的 system prompt 已经较大，随着 workspace files 和 memory 的加入还会继续增长。

**多个 cache_control 标记的逐 section 缓存**：粒度更细，但也更复杂。等 section 级别命中率有了测量数据后，可以后续添加细粒度 caching。

## 影响

- `ContextAssembler` 必须输出 XML tagged sections，而不是 Markdown 标题。
- `AnthropicProvider.generate()` 必须将字符串 system content 包装成带 `cache_control` 的数组。
- `ContextAssembler` 中的 section 顺序必须遵循上述稳定靠前原则。
- Context assembly 测试必须匹配新的 XML 格式。
- 检查 system prompt 内容的测试必须考虑 XML tags。

## 相关文档

- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [Model Provider](../architecture/model-provider.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)

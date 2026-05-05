# Phase 3 精化计划

状态：就绪
日期：2026-05-04

English version: [phase-3-refinements.md](./phase-3-refinements.md)

## 目的

本计划跟踪 Phase 3 / Phase 4 文档回顾后识别出的三项代码改动。这些改动将实现对齐到已确认的 OpenClaw 标准和 Anthropic 最佳实践。

这些改动不增加新功能，只是修正实现以匹配现在已文档化的架构。

## 改动内容

### 1. Context Assembler 改用 XML Section 格式

**Package**：`packages/context/src/index.ts`

**问题**：Context assembler 目前产生 Markdown 标题分隔的 sections。决策文档 0006 确认 XML tags 才是正确格式。

**必需改动**：
- 将每个 section builder 的 Markdown 标题输出替换为 XML tagged 输出。
- 示例：`## Identity\n\n${content}` → `<identity>\n${content}\n</identity>`
- 涉及 sections：identity、runtime、safety、tooling、skills、workspace、session。

**测试影响**：
- 所有断言 section 文本的测试都需更新以匹配 XML 格式。
- XML tag 名称应与 section 名称完全一致。

**非目标**：不改变 section 内容、section 顺序或 section inputs。

### 2. 从 `ContextSkillSummary` 和 `SkillDefinition` 中移除 `when` 字段

**Packages**：`packages/context/src/index.ts`、`packages/skills/src/index.ts`

**问题**：两个 package 都在 skill 相关类型中定义了 `when` 字段。OpenClaw 源码研究确认，正确标准只使用 `name` + `description`。`when` 的意图应合并到 `description` 中。

**必需改动**：

`packages/context/src/index.ts`：
- 从 `ContextSkillSummary` 中移除 `when?: string`。
- 更新 skills section builder，不再输出 `when` 行。

`packages/skills/src/index.ts`：
- 从 `SkillDefinition` 中移除 `when?: string`。
- 从 `SkillSummary` 中移除 `when?: string`。
- 更新 `parseSKILLMd()`，不再提取 `when` 字段。
- 更新内置 skill 定义：将 `when` 内容合并到 `description` 中。
- 相应更新 `toSkillSummary()`。

**测试影响**：
- 断言 `when` 字段的 skills 测试需更新。
- 内置 skill 断言需更新。
- Context assembly skill section 测试需更新。

**CLI 影响**：
- `apps/cli/src/index.ts`：`/skills` 命令渲染 skill summaries，移除对 `when` 的引用。

**非目标**：不改变 skill 正文内容、加载逻辑或优先级规则。

### 3. 在 `AnthropicProvider` 中添加 Prompt Caching

**Package**：`packages/models/src/index.ts`

**问题**：`AnthropicProvider` 目前将 system prompt 作为普通字符串发送。决策文档 0006 确认应将其作为带 `cache_control: { type: "ephemeral" }` 的数组发送，以便 Anthropic 缓存稳定的 system prefix。

**必需改动**：
- 在 `AnthropicProvider.generate()` 中，将 `system` 参数从字符串改为包含一个对象的数组：`{ type: "text", text: systemContent, cache_control: { type: "ephemeral" } }`。
- 仅在 `systemContent` 非空时应用。

**测试影响**：
- 断言 Anthropic API 调用精确形态的测试需更新以匹配数组格式。
- 可注入的 `AnthropicClientLike` 接口和测试 stub 需处理数组形式。

**非目标**：不改变消息翻译、tool call 处理或错误归一化。

## 改动顺序

1. 先移除 `when` 字段（影响范围最小，纯内部类型）。
2. 再对 context assembler 应用 XML 格式（影响范围较广，涉及测试断言）。
3. 最后添加 prompt caching（Anthropic API 调用形态变化，仅限一个 provider）。

## 验收标准

- 三项改动全部完成后，`pnpm run check` 零错误、零测试失败。
- `/skills` CLI 命令不再渲染 `when:` 行。
- Context assembler 测试输出显示 XML tagged sections。
- Anthropic provider 以带 `cache_control` 的数组发送 `system`。

## 相关文档

- [Decision 0006 — XML Prompt Format and Caching](../decisions/0006-xml-prompt-format-and-caching.zh-CN.md)
- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [Skill System](../architecture/skill-system.zh-CN.md)
- [Model Provider](../architecture/model-provider.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)

# Context Package

English version: [README.md](./README.md)

## 架构概述

`@peewit/context` 负责 **Provider 无关的 context 组装**。它的工作是在任何 provider 特定格式化发生之前，决定模型看到什么内容。它接受原始输入（系统指令、运行时元数据、工具摘要、技能索引、权限指导、对话历史、用户消息），并生成可供任何 `ModelProvider` 使用的 `ModelInput`。

该包不感知所选用哪个模型、哪个 Adapter 负责渲染、或工具实际执行什么。它只负责将具名 section 排列成系统提示，并构建扁平的消息数组。

```
ContextAssembler.assemble(input)
  │
  ├─ section: identity      （full/minimal 下始终包含）
  ├─ section: runtime       （仅 full，提供运行时元数据时）
  ├─ section: tooling       （仅 full，有工具注册时）
  ├─ section: safety        （仅 full，提供权限指导时）
  ├─ section: skills        （仅 full，技能索引非空时）
  ├─ section: workspace     （仅 full，来自 AGENTS.md / SOUL.md 文件）
  ├─ messages: conversation_history
  └─ messages: user_message
  │
  ▼
ModelInput + ContextAssemblyReport
```

## 核心概念

### 具名 Section 与确定性顺序

系统提示由具名 section 按固定顺序组装，每个 section 用 XML 风格标签包裹（如 `<identity>…</identity>`）以便模型明确定位各段指导内容。顺序永不改变：identity → runtime → tooling → safety → skills → workspace。

这种确定性对以下方面至关重要：
1. **可预测的模型行为**：模型始终在相同位置找到指令。
2. **可测试的组装过程**：测试断言具体 section 内容和顺序。
3. **可检查的输出**：`ContextAssemblyReport` 记录哪些 section 被包含或省略及其原因。

### PromptMode

三种模式控制系统提示的组装程度：

| 模式 | identity | runtime + tooling + safety + skills + workspace | 适用场景 |
|---|---|---|---|
| `"full"` | ✓ | ✓ | 常规交互式会话 |
| `"minimal"` | ✓ | ✗ | 不需要工具或技能上下文的轻量任务 |
| `"none"` | ✗ | ✗ | 不需要 Agent 框架的工具调用（如摘要、分类） |

`"none"` 模式下完全不发出 system 消息——只有对话历史和用户消息。

### ContextAssemblyReport

每次 `assemble()` 调用都会随 `ModelInput` 一起返回 `ContextAssemblyReport`：
- `includedSections`：被包含的 section 名称列表。
- `omittedSections`：被跳过的 section 名称及其 `reason` 字符串。

`AgentRuntime` 使用 `report.includedSections.includes("identity")` 来填充 `context_assembled` 事件。Adapter 和测试可在不重新解析系统提示的情况下检查报告。

### 工作区提示文件

`DefaultContextAssembler` 接受 `workspacePromptFiles` 数组（如 `["AGENTS.md", "SOUL.md"]`）和 `readWorkspaceFile` 回调（默认 `fs.readFile`）。组装时，从 `{runtime.workspace}/{fileName}` 读取各文件，忽略 `ENOENT` 错误，将非空文件作为具名子 section 注入 `<workspace>` 中，从而自动加载项目级和用户级指令文件。

### compactMessages

`compactMessages(messages, provider, options?)` 在长 Agent 运行期间防止 context 窗口溢出。当 `messages.length > maxMessages`（默认 30）时：

1. 将消息分为 `old`（除最近 `keepRecent` 条外的所有消息）和 `recent`（最后 `keepRecent` 条，默认 12）。
2. 将 `old` 消息格式化为纯文本记录。
3. 调用模型 Provider 生成摘要。
4. 返回 `[{ role: "system", content: "Conversation summary:\n…" }, ...recent]`。

若模型调用失败，原始消息数组原样返回（安全降级）。摘要以 system 消息注入，让模型明白这是摘要而非原始对话。

## 实现原理

### Section 组装算法

```typescript
// full 模式伪代码
const parts: string[] = [];
parts.push(`<identity>\n${systemInstruction}\n</identity>`);

if (runtime) {
  parts.push(`<runtime>\n- Mode: …\n- Workspace: …\n- Date: …\n</runtime>`);
}

if (tools.length > 0) {
  const toolLines = tools.map(t => `- ${t.name} [${t.risk}]: ${t.description}`).join("\n");
  parts.push(`<tooling>\n${toolLines}\n</tooling>`);
}
// …safety, skills, workspace…

return {
  modelInput: {
    messages: [
      { role: "system", content: parts.join("\n") },
      ...recentMessages,
      { role: "user", content: userMessage }
    ]
  },
  report: { … }
};
```

context 包不了解模型的 token 限制。溢出防护由 `compactMessages`（运行时在每步模型调用前调用）或 Adapter 负责。

### 为何使用工具摘要而非工具定义

context 包接收 `ContextToolSummary[]`（name + description + risk）而非完整的 `ModelToolDefinition`，使其与工具 schema 细节解耦。运行时分别将 `ExecutableTool[]` 转为 `ContextToolSummary[]` 用于 context 组装，以及转为 `ModelToolDefinition[]` 用于 model API 调用。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 context 包及对 models 的依赖（用于 `ModelInput`、`ModelMessage`、`ModelProvider`）。 |
| `tsconfig.json` | TypeScript 配置 | 使用对 models 的项目引用构建 context。 |
| `src/index.ts` | Context 组装器 | 所有导出：`ContextAssembler`、`DefaultContextAssembler`、`ContextAssemblyInput/Result/Report`、`ContextRuntimeMetadata`、`ContextToolSummary`、`ContextSkillSummary`、`PromptMode`、`compactMessages`、`CompactionOptions`、`DEFAULT_COMPACTION_OPTIONS`。 |
| `src/index.test.ts` | Context 测试 | 保护每种 prompt mode 下的 section 排序、包含/省略逻辑、格式、工作区文件加载、组装报告和 `compactMessages` 压缩行为。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

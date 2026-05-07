# 模块 06：@vole/context

Status: Complete
Date: 2026-05-07

English version: `06-context.md`

相关源码：`packages/context/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md)阶段三（基础层模块）的一部分。在阅读本文档之前，
先读 [05-tools.zh-CN.md](./05-tools.zh-CN.md)——工具把摘要贡献给 context，你已经知道
为什么 `ContextToolSummary` 只有 `name`、`description` 和 `risk`。

**阅读前**：完整读一遍 `packages/context/src/index.ts`。重点关注每个节名称的含义
（`identity`、`runtime`、`tooling`、`safety`、`skills`、`workspace`）。

**核心问题**：
- 系统提示的每个 XML 节各有什么内容？
- 为什么 `ContextSkillSummary` 只有 `name` 和 `description`，没有技能体？
- `ContextAssemblyReport` 是什么，为什么需要它？
- `compactMessages()` 如何工作，压缩失败时会发生什么？

**检查点**：当你能描述一次 `full` 模式、3 个注册工具、2 个技能的运行会组装出什么样的
完整系统提示，说明你已经掌握了这个模块。

## 1. 这个模块做什么

**通俗解释**：把 `@vole/context` 想象成一位秘书，在每次与模型开会之前准备简报文件。
每次模型调用之前，秘书组装一个材料包：

- **你是谁**（identity 节——系统指令）
- **你目前的情况**（runtime——模式、工作区路径、今天的日期）
- **你有什么工具**（tooling——每个工具的名称、风险等级、描述）
- **安全规则**（safety——权限指南文本）
- **有哪些技能可用**（skills——只有紧凑索引，不是完整内容）
- **工作区指令**（workspace——AGENTS.md、SOUL.md 等）
- **之前的对话**（消息历史）
- **用户现在要什么**（当前用户消息）

秘书还会写一份记录，说明包含了什么、省略了什么以及原因（assembly report）。这份记录
用于调试和追踪。

**技术说明**：`@vole/context` 在每次循环步骤中组装发给模型 provider 的 `ModelInput`。
它把系统提示格式化为 XML 标签节，应用提示模式（full / minimal / none），加载工作区提示
文件，并可以用模型 provider 本身压缩过长的消息历史。

## 2. 为什么它存在

没有专用的组装层，每个适配器都会格式化自己的系统提示。CLI、Web、后台运行之间的提示会
出现差异。系统提示结构会硬编码在 core 逻辑里，无法独立测试。

`@vole/context` 创建了一个单一的、可审计的步骤，把「这里是所有信息」变成「这是模型可接
受的 payload」。Core 调用 `assembler.assemble(input)` 得到 `{ modelInput, report }`——
它永远看不到 XML 格式化逻辑。

## 3. 公开接口

```ts
interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>
}

interface ContextAssemblyInput {
  systemInstruction: string          // 基础 identity 文本
  runtime?: ContextRuntimeMetadata   // mode, workspace, currentDate
  tools?: ContextToolSummary[]       // name, description, risk——无 inputSchema
  skillIndex?: ContextSkillSummary[] // 只有 name, description——无技能体
  permissionGuidance?: string        // <safety> 节的文本
  recentMessages?: ModelMessage[]    // 对话历史
  userMessage: string                // 当前用户消息
  promptMode?: PromptMode            // "full" | "minimal" | "none"
}

interface ContextAssemblyResult {
  modelInput: ModelInput              // 可直接发给 ModelProvider
  report: ContextAssemblyReport       // 包含了什么、省略了什么
}

type PromptMode = "full" | "minimal" | "none"

// 压缩工具函数——不属于 assembler 接口
async function compactMessages(
  messages: ModelMessage[],
  modelProvider: ModelProvider,
  options?: Partial<CompactionOptions>
): Promise<ModelMessage[]>
```

## 4. 实现流程

`DefaultContextAssembler.assemble()` 逐节构建系统提示：

**`promptMode: "none"`**——跳过所有节，只返回消息 + 用户输入。`modelInput.messages`
里不加系统消息。

**`promptMode: "minimal"` 或 `"full"`**——始终添加 `<identity>` 节：
```
<identity>
{systemInstruction}
</identity>
```

**`promptMode: "full"` 额外添加**（当对应输入存在时）：

| 节 | XML 标签 | 内容 |
|---|---|---|
| 运行时上下文 | `<runtime>` | 模式、工作区路径、当前日期 |
| 工具列表 | `<tooling>` | 每个工具一行：`- 名称 [风险]: 描述` |
| 权限指南 | `<safety>` | 来自 core 的权限指南文本 |
| 技能索引 | `<skills>` | 每个技能一行：`- 名称: 描述` |
| 工作区文件 | `<workspace>` | AGENTS.md、SOUL.md 等的内容 |

每个节产生一个 `ContextSectionReport`，记录是否被包含，以及被省略的原因（如「没有注册
工具」、「没有加载技能」）。

最终的 `modelInput.messages` 数组是：
```
[
  { role: "system", content: "<identity>...</identity>\n<runtime>...</runtime>..." },
  ...recentMessages,
  { role: "user", content: userMessage }
]
```

## 5. OpenClaw 对照

| OpenClaw | Vole | 备注 |
|---|---|---|
| `bootstrap-prompt.ts` | `DefaultContextAssembler` | 系统提示组装 |
| `<identity>` / `<tooling>` XML 节 | 相同标签名 | 对齐的结构 |
| 提示模式（full, minimal, none） | `PromptMode` 类型 | 相同模式 |
| 工作区启动文件（AGENTS.md 等） | `workspacePromptFiles` 配置 | 相同概念 |
| 系统提示中的技能索引 | `skillIndex?: ContextSkillSummary[]` | 相同渐进式披露 |
| Context engine 压缩 | `compactMessages()` | OpenClaw 用插件引擎；Vole 用更简单的内置实现 |

## 6. 关键设计决策

**XML 标签节，而非纯文本**

系统提示使用命名的 XML 标签（`<identity>`、`<tooling>` 等）而不是散文标题。这给模型
提供了节之间的清晰结构边界。模型可以可靠地区分「这是工具列表」和「这是安全指南」，
而不依赖可能因版本不同而变化的散文格式。

**`ContextSkillSummary` 只有名称和描述——无技能体**

完整的 `SKILL.md` 内容（可能有数千词）永远不进入 context。`<skills>` 节只包含一个
紧凑索引：每个技能一行。

当模型判断某个技能与当前任务相关时，它调用 `load_skill("skill-name")` 按需获取完整
内容。这是渐进式披露：技能在索引中约花 100 tokens，触发前不花任何代价，触发后每轮
加载一次完整体。

**`ContextAssemblyReport` 让组装过程可观察**

每次 `assemble()` 调用都返回一个 `report`，与 `modelInput` 并列。report 列出哪些节被
包含、哪些被省略以及原因。Core 把这个信息放入 `context_assembled` 事件。这意味着追踪
查看器可以显示「模型看到了这些节」，而无需解析原始系统提示字符串。

**Compaction 是提炼，不是总结**

Compaction 和总结（summarisation）目标不同。总结是为人类读者提供可读的概览。Compaction
是提取 agent 继续工作所需的操作性信息：工具调用及其结果、达成的决策、发现的关键事实、
修改的文件、遇到的错误、当前任务状态。人类觉得值得回顾的内容，往往对 agent 下一步
要做什么毫无意义。

`compactMessages()` 使用参考 Claude Code 优先级清理策略的两阶段方式：

**第一阶段 — 机械精简（免费，无模型调用）**
旧消息中的工具结果消息通过 `thinToolMessage()` 替换为仅保留摘要的版本。工具输出（文件
内容、shell 标准输出、网页文本）是 context 中最大的消耗者，但一旦 agent 处理完并继续
往前，只有摘要重要。把 `{ ok: true, content: "...5000字符..." }` 换成
`{ ok: true, summary: "Read foo.ts." }` 让第二阶段调用更便宜，也让提炼摘要聚焦于决策而非原始数据。

**第二阶段 — 语义精简（一次模型调用）**
瘦身后的旧消息用 `modelProvider` 提炼成紧凑摘要。复用 agent 循环使用的同一个
`ModelProvider` 接口，不需要特殊 API。

**失败处理**：如果第二阶段失败（网络错误、模型错误），返回第一阶段瘦身后的消息——
而非原始消息。第二阶段调用失败后，工具输出内容永远不会恢复到 context 中。这意味着即使失败，compaction 也始终会缩减 context 大小——精简后的消息比原始消息小。

**工作区文件在每次调用时都重新加载**

`#loadWorkspacePromptSections()` 在每次 `assemble()` 调用时从磁盘读取工作区提示文件。
没有缓存。这确保 agent 始终看到最新版本的工作区指令。如果文件不存在，静默跳过
（`ENOENT` 被捕获忽略）。其他文件系统错误会向上传播。

## 7. 测试方式

测试在 `packages/context/src/index.test.ts`。所有工作区文件加载通过可注入的
`readWorkspaceFile` 依赖测试——不需要真实磁盘访问。

测试类别：
- Full 模式：输入完整时所有节都存在
- Minimal 模式：只有 identity 节，无 tooling/skills/safety/workspace
- None 模式：完全没有系统消息
- 缺少可选字段：节被省略，report 中有正确原因
- `ContextAssemblyReport` 内容和结构
- 压缩：触发阈值，system 消息保留，摘要替换旧消息，最近消息原文保留
- 第一阶段瘦身：旧消息中的工具输出替换为摘要版本
- 压缩失败：返回瘦身后的消息（而非原始消息）
- 最近消息原文：recent 范围内的大型工具输出永远不被瘦身

## 8. 关键洞察

**系统提示在每次循环步骤都重新构建。** 迭代之间没有缓存。每次 `runTurn` 调用
`assemble()` 时，完整提示都重新构建。这是必要的，因为技能索引、工具列表或工作区文件
在调用之间可能改变，模型必须始终看到一致的当前状态。

**`ContextToolSummary` 刻意排除了 `inputSchema`。** 工具包含用于输入校验的 JSON schema，
但组装器只向模型发送 `name`、`description` 和 `risk`。模型不需要 schema 来决定调用哪个
工具——它需要的是描述。Schema 作为 `ModelInput.tools`（工具定义数组）的一部分单独发送，
由 `AgentRuntime` 处理，不由组装器处理。

**`promptMode: "none"` 支持低开销后台运行。** 当后台调度器触发预配置任务时，描述工具、
技能和工作区 context 的大型系统提示可能是不必要的。`"none"` 模式允许只用任务消息运行
模型，降低 token 成本。

**Compaction 是提炼，不是总结。** 总结产生人类可读的回顾。Compaction 提取 agent 继续
工作所需的操作性信息。两者关注点不同：总结关注「发生了什么」，Compaction 关注「我接下来
还需要知道什么才能继续工作」。

**前置 system 消息受保护，不被压缩。** System 消息（含 `<identity>`、`<tooling>`、
`<safety>`、`<skills>`）必须在 compaction 后保持完整。如果不保护，随着对话历史积累，
agent 会丢失权限指南和技能索引。`compactMessages` 始终把 `messages[0]`（当其 role 为
`"system"` 时）置于提炼摘要之前。

**最近消息原文保留。** 最后 `keepRecent`（默认 12）条对话消息永远不被瘦身或汇总。它们
代表 agent 的当前工作记忆，不能被改变——模型依赖它们了解刚刚发生了什么。落在 recent
范围内的大型工具输出原封不动保留。

**工具输出是最大的 context 消耗者。** 一次文件读取或 shell 命令可能产生数千 token 的输出。
一旦 agent 处理完工具结果并继续往前，原始输出就不再有价值。`thinToolMessage()` 在构建
提炼文本前，把大型工具结果内容替换为 `summary` 字段（"Read foo.ts."、"Ran in 234ms exit 0."），
让压缩调用便宜得多。

**压缩结果成为系统消息。** `compactMessages()` 产生的提炼内容插入为
`{ role: "system", content: "Conversation summary:\n..." }`。这是压缩历史中唯一的系统
消息——当前 `assemble()` 调用产生的原始系统提示单独添加到 `modelInput.messages` 开头。

## 9. 复习问题

1. `full` 模式系统提示有哪六个命名节？每节各有什么内容？
   > `<identity>`：基础系统指令。`<runtime>`：模式、工作区路径、日期。
   > `<tooling>`：每个工具一行，含名称、风险、描述。`<safety>`：权限指南文本。
   > `<skills>`：每个技能的名称和描述紧凑索引。`<workspace>`：工作区提示文件
   > （AGENTS.md、SOUL.md 等）的内容。

2. 为什么 `ContextSkillSummary` 只有 `name` 和 `description`，没有完整技能体？
   > 渐进式披露。完整技能体每个可能有数千词。把所有技能都包含在每次提示里成本很高。
   > 模型读取紧凑索引决定技能是否相关，然后调用 `load_skill()` 按需获取完整体。技能
   > 在索引中约花 100 tokens，触发前零成本。

3. `ContextAssemblyReport` 是什么，为什么需要它？
   > 记录某次 `assemble()` 调用中哪些节被包含、哪些被省略（含原因）。它让 context 组装
   > 过程可观察——追踪查看器和适配器可以显示「模型看到了 identity、tooling 和 safety，
   > 但没有技能被加载」，无需解析原始系统提示字符串。

4. `compactMessages()` 何时触发？压缩后的历史是什么样的？
   > 当 `estimateMessageTokens(messages) > maxTokens`（默认 60 000）**或**
   > `messages.length > maxMessages`（默认 400，安全兜底）时触发。Token 数通过
   > `ceil(总字符数 / 4)` 估算——字符/token 启发式，不需要 API 调用。
   > 旧消息被汇总成一条 `{ role: "system", content: "Conversation summary:\n..." }` 消息。
   > 最近 `keepRecent`（默认 12）条消息原文保留。结果是 `[摘要系统消息, ...最近 12 条]`。

5. `compactMessages()` 失败时（如模型 provider 返回错误）会发生什么？
   > 返回 Phase 1 精简后的消息——而非原始消息。Phase 1 已经用摘要版本替换了大型工具结果内容。压缩失败是静默且非致命的。Agent 用精简后（但未完全提炼）的历史继续运行。第二阶段调用失败后，工具输出内容永远不会恢复到上下文中。

6. 为什么系统提示在每次 `assemble()` 调用时重新构建而不是缓存？
   > 技能、工具和工作区文件在调用之间可能改变。缓存会意味着模型可能根据旧指令行动。
   > 每次重新构建保证模型始终看到当前状态。成本是每次调用都重建 XML 格式——考虑到
   > payload 无论如何都要通过网络发送，这是可接受的。

7. `minimal` 提示模式调用中，`modelInput.messages` 里有什么？
   > `[{ role: "system", content: "<identity>...</identity>" }, ...recentMessages,
   > { role: "user", content: userMessage }]`。只包含 identity 节。runtime、tooling、
   > safety、skills 和 workspace 节全部省略。

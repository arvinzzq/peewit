# Prompt Assembly

状态：草案
日期：2026-05-02

English version: [prompt-assembly.md](./prompt-assembly.md)

## 1. 目的

Prompt assembly 为一次 Agent run 构建模型可见的指令和上下文。

OpenClaw 调研说明，prompt construction 是核心架构关注点，不是 CLI 细节。Vole 应遵循这个方向，让 prompt assembly 显式、可测试、在 trace 中可见，并与 entry adapters 解耦。

核心规则：

Adapters 收集用户输入。Prompt assembly 决定模型看到什么。

## 2. 为什么这个模块存在

没有 prompt assembly 模块时，system instructions、skills、tools、memory、workspace files 和 session context 往往会直接混进 CLI 或 runtime 代码里。

这会带来问题：

- Prompt behavior 变得难以测试。
- CLI 和 Web UI 可能产生不同 Agent 行为。
- Workspace files 可能以不一致顺序加载。
- Skills 可能被过度注入或注入不足。
- 敏感内容可能未经 redaction 就进入 context。
- 未来 context engine 和 compaction 工作会更难。

Prompt assembly 给 Vole 提供了所有 model-facing context 的受控边界。

## 3. 输入

MVP prompt assembly 应接受结构化输入：

- Base system instructions
- Runtime metadata
- Effective configuration
- Current date and time
- Current workspace
- Current autonomy mode
- Permission policy guidance
- Tool definitions
- Skill index
- Session resume context
- Recent trace summaries
- User message

Phase 3 Part A 已完成：`ContextAssemblyInput` 已扩展 `tools?: ContextToolSummary[]`、`skillIndex?: ContextSkillSummary[]` 和 `permissionGuidance?: string`。Assembler 现在在提供这些输入时生成 tooling、safety 和 skills sections。Skill loader（Part C）尚未实现。

后续 phases 增加：

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- Daily memory files
- Context compaction summaries
- Context engine outputs
- Plugin-provided context

## 4. 输出

Prompt assembly 应返回结构化 model input，而不只是字符串。

预期输出：

- System messages 或 system sections
- Conversation messages
- Tool definitions
- 用于 trace 的 context metadata
- Redaction metadata
- 用于 debug 和 tests 的 prompt assembly report

这种结构让不同 model providers 可以用 provider-specific 方式渲染最终请求，而不改变 assembly rules。

## 5. MVP Prompt Sections

MVP 应从一组小而稳定的 sections 开始：

- Identity：Vole 是什么
- Runtime：当前 mode、workspace、date 和 model context
- Safety：permission policy 和 blocked behavior
- Tools：可用 tool summary
- Skills：compact skill index
- Session：最近 conversation 和 observations
- User request：当前消息

这比 OpenClaw 的完整 prompt 更小，但遵循显式 sections 的同一原则。

## 6. OpenClaw-Like Future Sections

后续 phases 可以增加 OpenClaw-like sections：

- Tooling
- Execution Bias
- Safety
- Skills
- Workspace
- Documentation
- Workspace Files
- Sandbox
- Current Date & Time
- Reply Tags
- Heartbeats
- Runtime
- Reasoning guidance

Vole 只有在 section 行为可以被文档化和测试时才应增加它。

## 7. Skill Index

MVP prompt assembly 应包含 compact skill index，而不是每个完整 skill body。

Skill index 应包括：

- Skill name
- Description（同时用作路由触发器——没有单独的 `when` 字段）
- Source location

如果 Agent 当前任务需要完整 skill body，通过 skill system 按需加载。

这遵循 OpenClaw 的思路：模型可以知道哪些 skills 存在，而不需要每次 model call 都塞满完整 `SKILL.md` 正文。详见 `skill-system.md` 第 5 节了解已确认的标准格式。

## 8. Tool Projection

Prompt assembly 应把 tools 投影成 model-facing definitions。

Projection 应包括：

- Tool name
- Description
- Input schema
- 相关 safety notes

Tool projection 不应包含实现细节或 secret configuration。

## 9. Workspace Files

Workspace prompt files 应通过 prompt assembly 或 context assembly 加载，而不是由 Agent Core 或 CLI 临时随意读取。

计划加载阶段：

- Phase 5 current：存在时，从 configured workspace root 读取 `AGENTS.md` 和 read-only `SOUL.md`。
- Phase 5：memory policy 就绪后加入 `USER.md`、`MEMORY.md` 和 daily memory files。
- 后续：`TOOLS.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`。

每次 workspace file load 都应在 trace 中可见。

## 10. Redaction

在可行时，Prompt assembly 必须在内容进入 model context 前应用 redaction。

Redaction targets：

- API keys
- Environment secrets
- Secret-like file contents
- Credentials
- Large raw tool outputs
- Sensitive provider metadata

如果内容被 redacted，prompt assembly report 应记录发生了 redaction。

## 11. Prompt Assembly Report

每次 assembled prompt 都应该能够产生 report。

Report 应包括：

- Included sections
- Omitted sections
- 可用时的 token 或 size estimates
- Skill index entries
- Tool count
- Workspace files loaded
- Redaction events
- Context truncation 或 compaction events

Report 支持 debugging、trace 和 tests。

## 12. 与 Context Engine 的关系

Prompt assembly 是 context construction 的确定性第一版实现。

未来 context engine 可以扩展或替换 prompt assembly 的部分能力：

- Context projection
- Compaction
- Memory retrieval
- Plugin-provided context
- Provider-specific formatting

MVP 应在引入 pluggable context engines 前，让 prompt assembly 保持简单和确定性。

## 13. 与 Model Provider 的关系

Prompt assembly 应产生 provider-neutral model input。

Model provider 负责把该 input 转换成 vendor-specific request format。

这样 prompt policy 与 model API details 分离。

## 14. 测试要求

Prompt assembly 需要测试，因为很小的 prompt 变化都可能改变 Agent 行为。

必需测试领域：

- Section ordering
- Required section inclusion
- Skill index inclusion
- 默认排除 full skill body
- Tool projection
- Permission guidance inclusion
- Session context bounds
- 启用时的 workspace file loading order
- Redaction behavior
- Prompt assembly report contents

任何改变 system instructions、skills、tools、memory、context assembly 或 model provider formatting 的迭代，都应更新 prompt tests。

## 15. 验收标准

MVP prompt assembly 成功标准：

- CLI 不直接 assemble prompts。
- Agent Core 调用 prompt/context assembly module。
- Prompt output 是 provider-neutral。
- Skill index 被包含，但不倾倒 full skill bodies。
- Tool definitions 被一致投影。
- Permission guidance 出现在 model context 中。
- 敏感内容进入 context 前应用 redaction。
- Prompt assembly behavior 被 unit tests 覆盖。

## 16. XML Section 格式

Prompt sections 应使用 XML tags 作为分隔符，而不是普通 Markdown 标题。

示例：

```xml
<identity>
Vole 是一个受 OpenClaw 启发的个人通用 Agent...
</identity>

<tooling>
可用 tools：read_file、list_directory、write_file、run_shell、read_web_page
</tooling>

<skills>
- research：调查外部信息或比较来源时使用。
- safe-shell：执行 shell 命令前评估风险时使用。
</skills>
```

原因：

- Anthropic 模型经过训练，会把 XML tags 识别为结构化分隔符，而不是正文内容。这产生更可靠的 section 边界识别。
- XML tags 能无歧义地把 section 意图与正文文字分开。
- Tags 在测试中易于确定性解析。
- 这是 Anthropic 官方推荐的复杂 system prompt 结构化方式。

决策记录：[0006 — XML Prompt Format and Caching](../decisions/0006-xml-prompt-format-and-caching.zh-CN.md)

Section 顺序原则：稳定 sections 靠前（identity、safety），易变 sections 靠后（skills、tools、workspace files）。这支持第 17 节描述的 caching 策略。

## 17. Prompt Caching

`AnthropicProvider` 应对 system content 应用 prompt caching。

Anthropic API 支持在 system content blocks 上加 `cache_control: { type: "ephemeral" }` 标记。在一个 cache window 内，首次发送带此标记的 system block 后，同一 window 内的后续调用可以复用已缓存的前缀，不需要重新处理稳定内容。

策略：

- 在 system content array 的最后一个稳定 block 上加 `cache_control: { type: "ephemeral" }`。
- Section 顺序应把易变内容（skills、workspace files、current date/time）放在最后，让稳定内容尽可能多地被缓存。
- MVP 可以对整个 system block 应用 caching，因为单次 turn 的 system content 通常基本不变。

这降低了多轮会话中 system prompt 较大但变化较少时的成本和延迟。

决策记录：[0006 — XML Prompt Format and Caching](../decisions/0006-xml-prompt-format-and-caching.zh-CN.md)

## 18. 相关文档

- [主设计](../product/vole-design.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md)
- [Context Engine](./context-engine.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Model Provider](./model-provider.zh-CN.md)
- [Skill System](./skill-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Decision 0006 — XML Prompt Format and Caching](../decisions/0006-xml-prompt-format-and-caching.zh-CN.md)

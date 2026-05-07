# Phase 3：Context Assembly 与 Skills

状态：已完成
日期：2026-05-04

English version: [phase-3-context-assembly-and-skills.md](./phase-3-context-assembly-and-skills.md)

## Progress

状态：已完成

已完成：

- Part A：Context section 架构。
  - 具名 sections：identity、runtime、tooling、safety、skills、workspace、conversation_history、user_message。
  - `packages/context` 添加了 `ContextToolSummary`、`ContextSkillSummary`、`ContextSectionReport` 类型。
  - `ContextAssemblyInput` 扩展了 `tools?`、`skillIndex?`、`permissionGuidance?`。
  - `ContextAssemblyReport` 扩展了 `sections: ContextSectionReport[]`。
  - `AgentRuntime` 将 tools 投影为 `ContextToolSummary[]` 并在每轮传入默认 permission guidance。
  - 所有测试通过。

- Part B：Anthropic provider。
  - 使用 `@anthropic-ai/sdk` 在 `packages/models` 添加 `AnthropicProvider`。
  - 翻译消息、tool definitions 和 tool results 为 Anthropic 格式。
  - 将 `tool_use` 响应 blocks 解析为 `ModelToolCallsOutput`。
  - 归一化 Anthropic API 错误。
  - `ANTHROPIC_API_KEY` 环境变量在 `packages/config` 中设置 `model.provider = "anthropic"`。
  - CLI 在 `config.model.provider === "anthropic"` 时使用 `AnthropicProvider`。
  - 所有测试通过。

- Part C：Skill system。
  - `packages/skills` 含 `SkillDefinition`、`SkillSummary`、`SkillLoader`、`parseSKILLMd`、`toSkillSummary`。
  - 三个内置技能：research、project-inspector、safe-shell。
  - 优先级：workspace > user > built-in；可注入文件系统操作用于测试。
  - `AgentRuntime` `skillIndex` 依赖；每轮传入 context assembler。
  - CLI 通过 `SkillLoader` 加载技能，传给 runtime，通过 `/skills` slash command 展示。
  - 所有测试通过。

剩余：无。Phase 3 已完成。

## 1. 目的

Phase 3 弥合架构文档描述与实际实现之间的差距，然后在该基础上构建轻量 skill 系统。

两个紧密耦合的目标：

1. 将 context assembly 提升到 `context-engine.md` 和 `prompt-assembly.md` 所描述的水平：基于 section 的 system prompt、工具描述对模型可见、权限指导、skill index。
2. 实现轻量 skill 系统，插入 section 架构。

这两个目标紧密耦合，因为 skills 将 compact index 注入 context assembler 的 skills section。没有 section 架构，skills 就没有干净的插入点。

Phase 3 也解决 Phase 2 的一个遗漏：tool definitions 目前完全绕过 context assembler。runtime 自己将工具转换为 `ModelToolDefinition[]` 并直接传给 `ModelInput.tools`，context assembler 对可用工具一无所知。Phase 3 通过 assembler 传递 tool summaries 来修复这一问题。

OpenClaw 对齐说明：

Phase 3 使 Vole 与 OpenClaw 的核心 prompt assembly 概念对齐：每次 model call 之前，都会接收一个有明确命名 section 的结构化 context 文档。Tools、skills 和 safety guidance 是一等的 section，而非事后补丁。

参考：[Prompt Assembly](../architecture/prompt-assembly.md)、[Context Engine](../architecture/context-engine.md)、[Skill System](../architecture/skill-system.md)

## 2. 用户结果

Phase 3 完成后：

- Agent 的 system prompt 有命名的 section：identity、runtime、tooling、safety、skills、workspace。
- 模型通过 tooling section 知道哪些工具可用，而不仅依赖 API schema。
- 用户可以在 `<workspace>/skills/` 放置 `SKILL.md` 文件，agent 会加载它。
- Agent 在每次 model call 时都能参考 compact skill 指导。
- 聊天中 `/skills` 列出已加载的 skills。
- 设置 `ANTHROPIC_API_KEY` 即可直接使用 Claude。
- `/trace` 或 context assembly report 显示哪些 section 被包含。

## 3. 范围

Phase 3 包含：

- `packages/context` 中的基于 section 的 context assembly。
- `ContextToolSummary` 和 `ContextSkillSummary` 类型。
- Tool summaries 从 `AgentRuntime` 传递给 context assembler。
- System prompt 中的 permission guidance section。
- System prompt 中的 skill index section。
- `packages/skills` 实现：scanner、SKILL.md 解析器、优先级。
- 内置 skills：research、project-inspector、safe-shell。
- CLI `/skills` slash command。
- `packages/models` 中的 Anthropic provider。
- Config 扩展支持 Anthropic API key 和 provider 选择。

Phase 3 不包含：

- Context compaction。
- 运行时 on-demand 加载完整 SKILL.md 体内容。
- 流式模型输出。
- Skill marketplace 或远程 skill 安装。
- Memory 写入。
- Provider 路由或 fallback。
- Skill 权限声明。

## 4. 新增架构

### 4.1 Context Section 架构

`packages/context` 引入 section 概念：

```typescript
export interface ContextSection {
  name: string;
  content: string;
}
```

`ContextAssemblyInput` 新增可选输入：

```typescript
export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  tools?: ContextToolSummary[];
  skillIndex?: ContextSkillSummary[];
  permissionGuidance?: string;
  recentMessages?: ModelMessage[];
  userMessage: string;
}

export interface ContextToolSummary {
  name: string;
  description: string;
  risk: "low" | "medium" | "high" | "blocked";
}

export interface ContextSkillSummary {
  name: string;
  description: string;
  when: string;
}
```

`DefaultContextAssembler` 按顺序从以下 sections 组装 system prompt：

```
[identity]    systemInstruction
[runtime]     mode、workspace、currentDate
[tooling]     每个工具的名称 + 描述 + 风险级别
[safety]      permissionGuidance
[skills]      compact skill index（名称 + 使用时机）
[workspace]   AGENTS.md、SOUL.md
[memory]      USER.md、MEMORY.md、daily notes（当启用时）
```

`ContextAssemblyReport` 新增 per-section 包含详情：

```typescript
export interface ContextSectionReport {
  name: string;
  included: boolean;
  reason?: string;
}

export interface ContextAssemblyReport {
  includedSections: string[];
  omittedSections: string[];
  sections: ContextSectionReport[];
}
```

### 4.2 AgentRuntime 更新

`AgentRuntime` 在调用 context assembler 之前，将已注册的 `ExecutableTool[]` 转换为 `ContextToolSummary[]`。Assembler 生成 tooling section。Runtime 继续独立生成 `ModelToolDefinition[]` 用于 `ModelInput.tools`（API 参数）。两条路径并行运行。

### 4.3 Anthropic Provider

`packages/models` 新增 `AnthropicProvider`：

- 使用 `@anthropic-ai/sdk`。
- 将 `ModelInput` 转换为 Anthropic `messages` 格式。
- 将 `ModelInput.tools` 转换为 Anthropic tool definitions。
- 将 `tool_use` content blocks 解析为 `ModelToolCallsOutput`。
- 将 tool results 格式化为 `tool_result` content blocks。
- 将 Anthropic API 错误归一化为 `ModelErrorOutput`。

配置：

```json
{
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "maxTokens": 4096
  }
}
```

环境变量：

```text
ANTHROPIC_API_KEY
```

### 4.4 Skill 系统

`packages/skills` 实现：

- `SkillDefinition`：name、description、when、steps、safety。
- `SkillSummary`：name、description、when（compact，用于 context index）。
- `SkillLoader.load(options)` 按优先级顺序扫描 skill 目录：
  1. `<workspace>/skills/`
  2. `~/.vole/skills/`
  3. 内置 skills
- SKILL.md 格式：h1 name，description、when、steps、safety notes 各节。
- 内置 skills：`research`、`project-inspector`、`safe-shell`。

CLI 新增 `/skills` slash command，列出已加载 skills 的名称和使用时机。

`AgentRuntime` 或 CLI composition 在每次会话前加载 skill index，并将 `ContextSkillSummary[]` 传给 context assembler。

## 5. 学习文档

更新：

- `docs/architecture/prompt-assembly.md`
- `docs/architecture/context-engine.md`
- `docs/architecture/model-provider.md`
- `docs/architecture/skill-system.md`
- `docs/decisions/0005-anthropic-provider.md`（新建）

## 6. 验收标准

Phase 3 完成的条件：

- Context assembler 在有工具注册时，包含 tooling section（工具名称、描述、风险级别）。
- Context assembler 在有 skill index 时，包含 skills section。
- Context assembler 包含 safety section（permission guidance）。
- `ContextAssemblyReport` 显示每个 section 的包含/省略详情。
- `AgentRuntime` 在每次 model call 之前将 tool summaries 传给 assembler。
- 配置 `model.provider: "anthropic"` 和 `ANTHROPIC_API_KEY` 后，Anthropic provider 可选。
- `<workspace>/skills/` 中的 SKILL.md 文件被加载并出现在 skill index 中。
- CLI `/skills` 命令列出已加载 skills。
- 内置 skills 默认可用。
- Skills 通过 system prompt 引导 agent 行为，不绕过工具或权限系统。
- 所有测试通过，`pnpm run check` 成功。

## 7. 非目标

- Context compaction。
- 运行时 on-demand 加载完整 SKILL.md 体内容。
- 流式模型输出。
- Skill marketplace 或远程 skill 安装。
- Memory 写入策略或实现。
- Provider 路由、fallback 或多 provider 配置。
- Skill 权限声明。

## 8. 计划工作

### Part A：Context Section 架构

1. 在 `packages/context` 中定义 `ContextToolSummary` 和 `ContextSkillSummary`。
2. 扩展 `ContextAssemblyInput`，加入 `tools?`、`skillIndex?`、`permissionGuidance?`。
3. 将 `DefaultContextAssembler` 重新设计为基于 section 的 system prompt 组装。
4. 更新 `ContextAssemblyReport`，加入 per-section 详情。
5. 更新 `AgentRuntime`，将注册工具转换为 `ContextToolSummary[]` 传给 assembler。
6. 添加默认 permission guidance 字符串。
7. 更新 `packages/context` 源文件头、README、AGENTS。
8. 更新 `packages/core` 源文件头。
9. 添加 context section 测试。

### Part B：Anthropic Provider

1. 在 `packages/models` 中添加 `@anthropic-ai/sdk` 依赖。
2. 实现 `AnthropicProvider` 类。
3. 扩展 `packages/config`，支持 `provider: "anthropic"` 和 `ANTHROPIC_API_KEY` 环境变量。
4. 更新 CLI composition，在配置时创建 `AnthropicProvider`。
5. 添加 fake HTTP 测试。
6. 更新 `packages/models` 和 `packages/config` 源文件头及模块文档。

### Part C：Skill 系统

1. 实现 `packages/skills`：`SkillDefinition`、`SkillSummary`、`SkillLoader`。
2. 定义 SKILL.md 格式。
3. 添加内置 skills：`research`、`project-inspector`、`safe-shell`。
4. 更新 `AgentRuntime` 或 CLI composition，在每次会话前加载 skills。
5. 将 `ContextSkillSummary[]` 传给 context assembler。
6. 为 CLI 添加 `/skills` slash command。
7. 更新 `packages/skills` 源文件头、README、AGENTS。
8. 更新 `apps/cli` 源文件头、README、AGENTS。
9. 添加 skill 系统测试。

### 文档梳理

1. 更新架构文档，反映 Phase 3 实现。
2. 更新 roadmap Phase 3 状态。
3. 更新 README。

## 9. 测试

Phase 3 必要测试：

- Context assembler 在有工具时生成 tooling section。
- Context assembler 在无工具时省略 tooling section。
- Context assembler 在有 skill index 时生成 skills section。
- Context assembler 在有 permission guidance 时生成 safety section。
- Section 顺序是确定的。
- Context assembly report 包含 per-section 详情。
- Anthropic provider 发送正确的消息格式。
- Anthropic provider 发送正确的 tool definitions。
- Anthropic provider 将 tool_use blocks 解析为 ModelToolCallsOutput。
- Anthropic provider 归一化 Anthropic 错误。
- Skill loader 发现 workspace 目录中的 SKILL.md 文件。
- Skill loader 遵循优先级：workspace 覆盖 user 覆盖 built-in。
- SKILL.md 解析提取 name、description、when、steps。
- Skill index summary 仅包含 compact 字段。
- CLI /skills 列出已加载 skills。
- AgentRuntime 在每轮中将 tool summaries 传给 assembler。
- 端到端：模型在 system prompt 中接收到 tooling section。

## 10. 提交计划

建议提交顺序：

1. `feat(context): add section architecture and tool/skill summary inputs`
2. `docs: update context assembly docs for section architecture`
3. `feat(core): pass tool summaries to context assembler`
4. `docs: update core docs for context assembly flow`
5. `feat(models): add Anthropic provider`
6. `feat(config): add Anthropic provider configuration`
7. `feat(cli): wire Anthropic provider in composition`
8. `docs: update model provider docs for Anthropic`
9. `feat(skills): add skill loader and SKILL.md parser`
10. `feat(skills): add built-in skills`
11. `feat(cli): add /skills command and wire skill index`
12. `docs: update skill system docs`
13. `test: cover context assembly sections, Anthropic provider, and skill system`
14. `docs: complete phase 3`

## 11. 相关文档

- [Roadmap](../roadmap/overview.md)
- [Prompt Assembly](../architecture/prompt-assembly.md)
- [Context Engine](../architecture/context-engine.md)
- [Skill System](../architecture/skill-system.md)
- [Model Provider](../architecture/model-provider.md)
- [Agent Loop](../architecture/agent-loop.md)
- [Runtime Composition](../architecture/runtime-composition.md)
- [OpenClaw Architecture Map](../architecture/openclaw-architecture-map.md)
- [Decision 0005: Anthropic Provider](../decisions/0005-anthropic-provider.md)

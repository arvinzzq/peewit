# Execution Contract

状态：设计
日期：2026-05-11

English version: [execution-contract.md](./execution-contract.md)

## 1. 目的

Execution contract 控制 agent runtime 执行规律性的严格程度，以及每次运行时渲染多少 system prompt。

不同使用场景需要不同的权衡：

- 交互式聊天 session 需要最小的开销 — 低延迟、可读响应、低 token 成本。
- 自主编码 agent 需要最严格的执行 — 紧密的停滞检测、强制 tool 使用、强制任务追踪。
- 后台自动化任务需要精简的 prompt — 没有身份前导，没有帮助文本，只有任务指令。

Execution contract 将这些权衡捕获为单一可配置类型，使其明确且可测试。

## 2. ExecutionContract 类型

```typescript
type ExecutionContract = "default" | "strict-agentic";
```

Contract 通过 `RunOptions` 按每次运行设置。如果未指定，使用 `"default"`。

```typescript
interface RunOptions {
  executionContract?: ExecutionContract;
  promptMode?: PromptMode;
  thinkingBudget?: ThinkingBudget;
  // ... 其他运行选项
}
```

## 3. Strict-Agentic 行为

当 `executionContract` 为 `"strict-agentic"` 时，`AgentRuntime` 应用更严格的执行规则：

| 设置 | Default | Strict-Agentic |
| --- | --- | --- |
| 中止前最大停滞 turns | 3 | 5 |
| 停滞重试指令 | 简短提醒 | 强制："You must call a tool now." |
| `update_todos` 执行 | 可选 | 自动注册且必须 |
| 反规划守卫 | 启用 | 更严格的模式匹配 |
| 空 tool 响应处理 | 警告 | 硬性停滞计数递增 |

Strict-agentic 模式下的停滞检测匹配：

- 模型产生了文本但零次 tool 调用的 turns
- 包含规划语言模式的 turns（`"I'll start by"`、`"First, I will"`、`"My plan is"`、`"Step 1:"`）
- 仅包含步骤列表而没有任何 tool 调用的 turns

在 strict-agentic 模式下，如果 `update_todos` 尚未存在，它会自动添加到运行的 tool registry 中。反停滞重试指令明确将 `update_todos` 命名为最低可接受的 tool 调用。

## 4. Prompt 模式

Prompt 模式控制 system prompt 的哪些部分被渲染：

```typescript
type PromptMode = "full" | "minimal" | "none";
```

| 模式 | 渲染内容 |
| --- | --- |
| `full` | 所有部分：身份、运行时上下文、tool 描述、skill index、安全指导、workspace 上下文 |
| `minimal` | 仅运行时上下文、tool 描述、任务指令 — 无身份前导、无 skill index、无安全说明 |
| `none` | 仅原始任务指令 — 无 system prompt 部分 |

`full` 是交互式 session 的默认值。

`minimal` 适用于 token 预算受限且模型已通过任务本身获得强执行指令的后台 agents 和 sub-agents。

`none` 保留给超受限场景（例如，评估框架、单元测试、调用者外部控制完整 system prompt 的 API 集成）。

`PromptMode` 由 `ContextAssembler` 在构建 system prompt 时应用。活动模式未包含的部分简单地不被组装。

## 5. Thinking Budget

Thinking budget 控制模型在产生响应之前的内部推理深度：

```typescript
type ThinkingBudget =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "adaptive"
  | "max";
```

| 级别 | 近似 token 预算 | 使用场景 |
| --- | --- | --- |
| `off` | 0（禁用） | 快速响应、简单查询 |
| `minimal` | ~512 | 轻度推理、快速 tool 选择 |
| `low` | ~1024 | 标准交互式 session |
| `medium` | ~4096 | 复杂单步任务 |
| `high` | ~8192 | 多步规划和编码 |
| `xhigh` | ~16384 | 深度分析、复杂重构 |
| `adaptive` | 动态 — 随任务复杂度扩展 | Strict-agentic 的默认 |
| `max` | 模型定义的最大值 | 研究、详尽分析 |

`ThinkingBudget` 是未来能力。初始实现仅支持 `"off"`（默认），并将设置路由到支持 thinking tokens 的 provider（当前为 Anthropic extended thinking）。对于不支持 thinking 的 provider，budget 设置会被静默忽略。

## 6. OpenClaw 对齐

OpenClaw 对自主编码和任务执行 session 使用 `executionContract: "strict-agentic"`。关键对齐：

| OpenClaw 概念 | Vole 等效 |
| --- | --- |
| `executionContract: "strict-agentic"` | `ExecutionContract = "strict-agentic"` |
| `promptMode: "minimal"` | `PromptMode = "minimal"` |
| Agentic 运行中强制 `update_plan` | Strict-agentic 中自动注册 `update_todos` |
| Extended thinking tokens | `ThinkingBudget` 接口 |
| 后台 prompt 精简 | `PromptMode = "none"` |

OpenClaw 的实现确认，strict-agentic contract 是长时间运行自主任务的主要模式，而 minimal/none prompt 模式在 sub-agent 和后台上下文中减少开销。

## 7. 验收标准

Execution contract 在满足以下条件时视为完成：

- `RunOptions.executionContract` 在每次运行前被 `AgentRuntime` 读取。
- `"strict-agentic"` 模式执行更严格的停滞检测阈值。
- `"strict-agentic"` 模式在 `update_todos` 尚未存在时自动注册它。
- `PromptMode` 被转发到 `ContextAssembler`，控制哪些部分被发出。
- `ThinkingBudget` 类型已定义；`"off"` 是默认值；当 budget 不是 `"off"` 时，Anthropic provider 路由 thinking tokens。
- 单元测试覆盖：默认 contract 行为、strict-agentic 停滞计数递增、prompt 模式部分抑制。

## 8. 相关文档

- [Agent Loop](./agent-loop.zh-CN.md)
- [Context Engine](./context-engine.zh-CN.md)
- [Prompt Assembly](./prompt-assembly.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [Background Automation](./background-automation.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

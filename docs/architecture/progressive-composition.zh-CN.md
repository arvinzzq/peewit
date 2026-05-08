# 渐进式组合

Status: Stable
Date: 2026-05-08

English version: [progressive-composition.md](./progressive-composition.md)

## 1. 目的

渐进式组合（Progressive Composition）是指 Vole agent 可以由任意模块子集组装而成的设计原则。最简单的可运行配置只需要一个 model provider，没有其他任何东西。各个模块可以逐一添加，每个可选模块在不需要时都有对应的 minimal 或 null 实现。

这让架构具备以下特性：

- **从 Layer 0 可测试**：只用 fake model 的裸 loop 无需任何真实依赖即可运行。
- **学习上清晰可辨**：每个模块可以独立理解，无需先组装完整系统。
- **对耦合有抵抗力**：若某模块无法干净地"摘掉"，说明存在边界违规。

## 2. 层叠模型

六层，按依赖关系排序：

| 层 | 新增能力 | 所需依赖 |
|---|---|---|
| 0 — 裸 loop | model → 输出 → 循环 | `ModelProvider` |
| 1 — Tools | model 可以调用已注册的 tools | Layer 0 + `ExecutableTool[]` |
| 2 — Permissions | tool call 执行前评估权限 | Layer 1 + `PermissionPolicy` |
| 3 — Sessions | 跨 turn 持久化对话 | 外部 `SessionStore`（调用方管理） |
| 4 — Context | 丰富的 system prompt、workspace 文件、compaction | Layer 0 + `ContextAssembler` |
| 5 — Multi-agent | agent 可以 spawn 专注的 sub-agent | Layer 1 + subagent tools |

各层不是严格串行的。Layer 4 不依赖 Layer 1–3。只要满足各自依赖，任意组合均有效。

## 3. 依赖关系图

```
model ──────────────────────────────────────────────────────┐
tools（可选）───────────────────────────────────────────────┤
permissions（可选，仅在有 tools 时有意义）────────────────────┤──► AgentRuntime
sessions（可选，外部管理——调用方负责）──────────────────────┤
context（可选）─────────────────────────────────────────────┤
multi-agent tools（可选，tools 的子集）──────────────────────┘
```

层间可接受的依赖关系：

- `permissions` 在有 `tools` 时最有意义——没有 tools 意味着没有需要评估的 action。
- `multi-agent` tools 需要调用方提供 `SubagentFactory`，使组合变为递归。
- `sessions` 始终由外部管理；`AgentRuntime.runTurn()` 接收 `recentMessages` 输入，并通过 `turn_complete` 事件将新消息返回给调用方持久化。

## 4. createAgent() 工厂函数

`createAgent()` 是在任意层组装 agent 的首选入口。它封装了 `new AgentRuntime()`，提供合理的默认值和更扁平的 API：

```ts
import { createAgent } from "@vole/core";
import { FakeModelProvider } from "@vole/models";

// Layer 0 — 裸 loop
const agent = createAgent({ model: new FakeModelProvider([...]) });

// Layer 1 — 添加 tools
const agent = createAgent({
  model: provider,
  tools: [readFileTool, runShellTool],
  permissions: new AlwaysAllowPolicy(),  // 来自 @vole/permissions
});

// Layer 2 — 显式 permission policy + approval
const agent = createAgent({
  model: provider,
  tools: [readFileTool, runShellTool],
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: myResolver,
});

// Layer 4 — 丰富的 context 组装
const agent = createAgent({
  model: provider,
  context: new DefaultContextAssembler({ workspaceFiles: ["AGENTS.md"] }),
  systemInstruction: mySystemPrompt,
});

// 完整配置——所有层
const agent = createAgent({
  model: provider,
  systemInstruction: AGENT_SYSTEM_INSTRUCTION,
  tools: allTools,
  permissions: new DefaultPermissionPolicy(),
  approvalResolver: cliApprovalResolver,
  context: new DefaultContextAssembler({ workspaceFiles: [...] }),
  compaction: { maxTokens: 60_000 },
  maxSteps: 20,
});
```

`createAgent()` 始终返回 `AgentRuntime`。Sessions 不属于工厂的职责——调用方向每次 `runTurn()` 传入 `recentMessages`，并从 `turn_complete` 事件中取出新消息进行持久化。

直接使用 `new AgentRuntime(dependencies)` 的方式继续有效。`createAgent()` 是所有不需要精细控制依赖对象的场景的首选 API。

## 5. Minimal / Null 实现

每个可选模块都有一个 minimal 实现，满足接口定义但不产生任何副作用。使用这些实现可以隔离被测试的层，并验证各层是否可以干净地分离。

| 模块 | 完整实现 | Minimal / Null |
|---|---|---|
| `ModelProvider` | `AnthropicProvider`、`OpenAICompatibleProvider` | `FakeModelProvider`（脚本化响应） |
| `ContextAssembler` | `DefaultContextAssembler`（XML sections、workspace 文件） | `MinimalContextAssembler`（直传） |
| `PermissionPolicy` | `DefaultPermissionPolicy`（风险 × 模式矩阵） | `AlwaysAllowPolicy`（放行所有非 blocked） |
| `ExecutableTool[]` | 完整内置工具集 | `[]`（空——不能发起 tool call） |
| `SessionStore` | `JsonlSessionStore` | `InMemorySessionStore`（无文件 I/O） |
| `ApprovalResolver` | CLI readline 提示 | *省略——"ask" 决策自动拒绝* |

### MinimalContextAssembler

不读取 workspace 文件，不应用 XML section 格式。仅在有 `systemInstruction` 时产生一条 system message，然后直接拼接 `recentMessages` 和 `userMessage`。

适用场景：测试 agent loop、tool dispatch 或 permission 逻辑，不需要验证 context assembly 行为时。

### AlwaysAllowPolicy

对所有非 blocked tool action 返回 `allow`，不考虑风险级别和自治模式。仍然遵守 `"blocked"` 风险级别——blocked tools 始终被拒绝。

适用场景：Layer 1 测试中需要 tool calls 直接执行而不配置 `ApprovalResolver` 时。也适用于所有 tools 被视为安全的沙箱评估环境。

## 6. 各层测试方式

层测试遵循统一模式：用 `FakeModelProvider` 控制 model 输出，为被测层之外的每层注入 minimal 实现，对发出的 `RuntimeEvent` 类型进行断言。

```ts
// Layer 0 — 验证 loop 运行并发出 run_completed
const agent = createAgent({
  model: new FakeModelProvider([{ type: "message", content: "ok" }])
});
const events = await collect(agent.runTurn({ message: "hi", recentMessages: [] }));
expect(events.at(-1)?.type).toBe("run_completed");

// Layer 1 — 验证 tool dispatch 和结果注入
const agent = createAgent({
  model: new FakeModelProvider([
    { type: "tool_calls", calls: [{ id: "c1", name: "echo", input: { text: "hello" } }] },
    { type: "message", content: "done" }
  ]),
  tools: [echoTool],
  permissions: new AlwaysAllowPolicy()
});
const events = await collect(agent.runTurn({ message: "echo hello", recentMessages: [] }));
expect(events.some(e => e.type === "tool_completed")).toBe(true);

// Layer 2 — 验证权限评估在执行前触发
const agent = createAgent({
  model: new FakeModelProvider([
    { type: "tool_calls", calls: [{ id: "c1", name: "run_shell", input: { command: "ls" } }] }
  ]),
  tools: [shellTool],
  permissions: new DefaultPermissionPolicy()
  // 无 approvalResolver → "ask" 决策自动拒绝
});
const events = await collect(agent.runTurn({ message: "ls", recentMessages: [] }));
expect(events.some(e => e.type === "tool_call_permission_evaluated")).toBe(true);
expect(events.some(e => e.type === "approval_requested")).toBe(true);
expect(events.some(e => e.type === "run_failed")).toBe(true);
```

层测试位于 `packages/core/src/create-agent.test.ts`。

## 7. 验收标准

渐进式组合正确实现的标志：

- `createAgent({ model })` 编译通过，无其他依赖即可成功执行一次 turn。
- 每层可以独立验证：移除一个模块不会破坏其他层的测试。
- `AlwaysAllowPolicy` 放行 low、medium、high 风险 tool call；拒绝 blocked。
- `MinimalContextAssembler` 不读取任何文件，产生有效的 `ContextAssemblyResult`。
- 直接 `new AgentRuntime()` 构造方式不受影响，仍然正常工作。
- 省略某个模块等价于将其替换为 null 实现——系统仍可运行。

## 8. 相关文档

- [Architecture Contracts](./contracts.md)
- [Runtime Composition](./runtime-composition.md)
- [Agent Loop](./agent-loop.md)
- [Permission System](./permission-system.md)
- [Context Engine](./context-engine.md)

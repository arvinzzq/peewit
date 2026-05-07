# 模块 04：@vole/permissions

Status: Complete
Date: 2026-05-07

English version: `05-permissions.md`

相关源码：`packages/permissions/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md)阶段三（基础层模块）的一部分。在阅读本文档之前，
先读 [02-core.zh-CN.md](./02-core.zh-CN.md)，这样你已经知道 `PermissionPolicy.evaluate()`
在循环的哪个位置被调用，以及每种决策会触发什么后续行为。

**阅读前**：完整读一遍 `packages/permissions/src/index.ts`——只有 82 行。然后阅读本文档
了解设计决策。

**核心问题**：
- 为什么 `evaluate()` 是同步的，即使它产生的决策可能导致用户交互？
- `blocked`（风险等级）和 `deny`（决策类型）有什么区别？
- 在 `auto` 模式下，哪些风险等级会被自动放行？
- 当决策是 `ask` 时，谁来处理用户交互？

**检查点**：当你能凭记忆填写完整的决策矩阵（模式 × 风险 → 决策）并解释每个格子为什么
是这个值，说明你已经掌握了这个模块。

## 1. 这个模块做什么

**通俗解释**：想象你雇了一个助手帮你管理电脑。助手很能干，但你需要一套规则决定「什么
事他能自己做，什么事要先问你，什么事永远不行」。这个模块就是那套规则。

两个输入，一个输出：

```
这件事有多危险？  +  你今天想管多细？  →  直接做 / 先问我 / 不行
```

**第一个维度：这件事有多危险？（风险等级，在工具定义时写死）**

| 风险等级 | 举例 |
|---------|------|
| `low` | 读文件、看目录 |
| `medium` | 写文件、创建文件 |
| `high` | 执行 shell 命令 |
| `blocked` | 被明确禁止的操作 |

风险等级是**静态的**——工具作者在定义工具时就设置好了，之后不会改变。`bash` 工具始终
是 `high` 风险，不管模型让它执行什么命令。这是刻意设计：权限边界必须可预期，不能因为
模型巧妙地构造了某种参数就被绕过。

**第二个维度：你今天想管多细？（自主模式，运行时设置）**

| 模式 | 含义 |
|-----|------|
| `observe` | 「我在学习观察，每一步都告诉我」 |
| `confirm` | 「日常小事自己做，重要的事问我」（默认） |
| `auto` | 「我去开个会，你尽量自己搞定」 |

**决策矩阵（模式 × 风险）**

| | low | medium | high | blocked |
|--|--|--|--|--|
| `observe` | ask | ask | ask | **deny** |
| `confirm` | **allow** | ask | ask | **deny** |
| `auto` | **allow** | **allow** | ask | **deny** |

**技术说明**：`@vole/permissions` 评估一个工具行动是否应该自动放行、暂停等待人工审批，
或者拒绝。它接受当前自主模式和工具的风险等级作为输入，返回一个带有 trace 可读原因的
决策。

它不发起任何网络调用，不执行 IO，不与用户交互，也没有任何异步代码。

## 2. 为什么它存在

模型可以请求任何已注册的工具。如果在"模型请求"和"工具执行"之间没有门控，一个有
问题的 prompt 或注入的指令就能删除文件、泄露密钥或执行破坏性命令。

`@vole/permissions` 就是这个门控。它是一个独立的包——而不是嵌入 core 的逻辑——因为
同一套策略必须在 CLI、Web、后台调度器和测试环境中完全一致地工作。保持它纯粹无依赖，
使它可以轻松测试和移植。

## 3. 公开接口

```ts
type AutonomyMode = "observe" | "confirm" | "auto"
type PermissionRiskLevel = "low" | "medium" | "high" | "blocked"
type PermissionDecisionType = "allow" | "ask" | "deny"

interface PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision
}

interface PermissionEvaluationInput {
  mode: AutonomyMode
  action: {
    kind: "tool"
    name: string
    summary: string
    risk: PermissionRiskLevel
  }
}

interface PermissionDecision {
  decision: PermissionDecisionType
  risk: PermissionRiskLevel  // 透传输入的风险等级
  reason: string             // trace 可读的原因说明
}

class DefaultPermissionPolicy implements PermissionPolicy
```

`PermissionPolicy` 接口是 `AgentRuntime` 所依赖的。`DefaultPermissionPolicy` 是内置实现。
自定义策略可以通过依赖注入替换它。

## 4. 实现流程

`DefaultPermissionPolicy.evaluate()` 实现了一个模式 × 风险决策矩阵：

| 模式 \ 风险 | `low` | `medium` | `high` | `blocked` |
|---|---|---|---|---|
| `observe` | ask | ask | ask | **deny** |
| `confirm` | **allow** | ask | ask | **deny** |
| `auto` | **allow** | **allow** | ask | **deny** |

逻辑按优先级顺序评估：

1. **`blocked` 无条件优先** — 如果 `risk === "blocked"`，无论任何模式都返回 `deny`。
   没有任何模式能覆盖被封锁的工具。

2. **`observe` 模式对所有操作都 ask** — `observe` 的目的是完全透明；每个行动都暂停等待
   确认，即使是低风险操作。

3. **`auto` 模式允许低和中风险，对高风险 ask** — `auto` 的目的是最少打扰，但高风险
   操作仍然需要人工签字。

4. **`confirm` 模式（默认）只允许低风险，中和高风险都 ask** — 最安全的交互模式：
   日常读操作自动运行，写操作和 shell 访问需要审批。

## 5. OpenClaw 对照

| OpenClaw | Vole | 备注 |
|---|---|---|
| 工具策略评估 | `PermissionPolicy.evaluate()` | 相同概念 |
| `effective-tool-policy.ts` | `DefaultPermissionPolicy` | 模式 × 风险矩阵 |
| 自主性 / 严格性级别 | `AutonomyMode` | OpenClaw 有更多级别；Vole 用三个 |

OpenClaw 的工具策略有更多粒度（按工具覆盖、工作区级别配置）。Vole 的
`DefaultPermissionPolicy` 刻意保持极简——一张矩阵，没有配置界面。通过接口提供的自定义
策略是扩展点。

## 6. 关键设计决策

**`evaluate()` 是同步的**

同步评估是刻意的约束。它强制这个包成为一个纯决策函数，没有副作用。用户交互——
询问"你批准吗？"——属于适配器层的 `ApprovalResolver`。两个关切被分离：

- `PermissionPolicy.evaluate()` → 返回 `ask` / `allow` / `deny`
- `ApprovalResolver.resolve()`（在 core 里，由适配器调用）→ 处理 UI 交互

这意味着同一个 `PermissionPolicy` 在 CLI、Web 和没有用户可以询问的无头后台运行中完全
相同地工作。

**`blocked` 是风险等级，不是决策类型**

`PermissionRiskLevel` 包含 `"blocked"`。`PermissionDecisionType` 不包含——它只有
`"allow" | "ask" | "deny"`。

当工具的 `risk: "blocked"` 时，策略把它映射到 `decision: "deny"`。这是刻意的：`blocked`
是工具定义的属性（在注册时设置），而 `deny` 是运行时结果。把它们放在不同的类型域里防止
混淆"这个工具被配置为禁止访问"和"这次特定请求被拒绝了"。

**`reason` 是给 trace 用的，不是给模型用的**

`PermissionDecision` 中的 `reason` 字符串不会显示给用户，也永远不会发送给模型。它存在
于 trace 事件和调试目的：`"High-risk action requires approval in auto mode."` 解释了运行
为什么暂停或被拒绝，而不需要读者在心里重建决策矩阵。

**`risk` 透传到决策结果**

`PermissionDecision` 包含了输入的 `risk` 等级。这让 core 可以发射
`tool_call_permission_evaluated` 事件，适配器可以显示审批提示，而无需再次查找工具定义。
决策携带了它自己的上下文。

## 7. 测试方式

测试在 `packages/permissions/src/index.test.ts`。五个测试覆盖完整矩阵：

- `confirm` 模式：low → allow，medium/high → ask
- `observe` 模式：所有非 blocked → ask
- `auto` 模式：low/medium → allow，high → ask
- `blocked` 风险：任何模式下都 deny

不需要 fake 或 mock——`DefaultPermissionPolicy` 是纯函数。测试直接调用 `evaluate()`，
传入构造好的输入，断言返回的决策。

## 8. 关键洞察

**最小的包承载了最重要的保证。** 82 行，代码库里最短的包，但它是 agent 不能被恶意
prompt 轻易武器化的原因。简单性本身是功能：代码越少，越少 bug，越容易审计。

**`observe` 模式是为了学习，不是为了安全。** `observe` 在每个操作之前暂停，包括低风险
的读操作。这对学习 agent 行为很有用——你在每一步执行前都能看到它要做什么。它不是比
`confirm` 更"安全"的模式；它是更透明的模式。

**`auto` 模式允许 `medium` 风险，这让新读者感到意外。** 在 `auto` 模式下，只有 `high`
和 `blocked` 需要审批。中等风险操作（通常是文件写入）自动运行。这是为后台/定时使用场景
刻意设计的——那些场景里没有人工可以审批日常操作。

**风险等级是静态的——在工具定义时写死，不在调用时决定。** `ExecutableTool` 上的 `risk`
字段由工具作者在创建工具时设置，之后永远不会根据模型传入的参数改变。`bash` 工具始终是
`high` 风险，无论模型让它运行 `echo hello` 还是 `rm -rf /`。这是刻意的：如果风险是动态
的，权限系统就可以被巧妙的模型输入绕过。静态风险意味着权限边界由工具的类型无条件强制
执行，而不是由模型调用时的意图决定。

**自定义策略是一等公民。** `AgentRuntime` 接受任何 `PermissionPolicy` 实现。你可以构建
一个按工具名称放行的策略、按路径模式拒绝的策略，或者只在特定时间段要求审批的策略——
所有这些都不需要碰 core。

## 9. 复习问题

1. 为什么 `evaluate()` 是同步的？把它改成 `async` 会有什么架构后果？
   > Async 意味着 IO 或等待——最可能是等待用户输入。这会把"评估"和"交互"两个职责
   > 合并到一个包里，使它无法在没有用户的无头/后台上下文中使用。

2. 在 `auto` 模式下，请求了一个 `risk: "medium"` 的工具。决策是什么？
   > `allow`。在 `auto` 模式下只有 `high` 和 `blocked` 需要审批。中等风险操作自动运行。
   > 这是为非交互式后台使用场景刻意设计的。

3. `blocked`（一个 `PermissionRiskLevel`）和 `deny`（一个 `PermissionDecisionType`）有什么区别？
   > `blocked` 在工具注册时设置在工具定义上——意味着这个工具永远不应该执行。`deny` 是
   > 运行时的决策结果，也可能来自用户拒绝了 `ask`。它们占据不同的类型域：一个描述工具
   > 属性，另一个描述运行时结果。

4. 在 `observe` 模式下，请求了一个 `risk: "low"` 的工具。决策是什么？
   > `ask`。`observe` 模式不管风险等级，对所有非 blocked 操作都暂停等待确认。它的目的
   > 是完全透明，不是自动化。

5. `PermissionDecision` 中的 `reason` 字段用于什么？
   > Trace 事件和调试。它永远不会发送给模型，也不会作为权限解释显示给用户。它用人类
   > 可读的形式解释了决策，供开发者读取日志或 trace 输出时使用。

6. `AgentRuntime` 默认使用 `DefaultPermissionPolicy`，但接受任何 `PermissionPolicy`。
   描述一个在特定场景下有用的自定义策略。
   > 示例：一个只读策略，只允许 `risk: "low"` 的工具，拒绝其他一切——不管模式是什么。
   > 适用于"安全探索"模式，agent 可以读文件和搜索，但不能写入、执行或发起网络调用。

7. 工具的 `risk` 等级在定义时就确定了。为什么不在调用时根据模型的输入动态决定风险？
   > 静态风险让权限边界被无条件强制执行。如果风险由模型的输入决定（比如"这条 bash
   > 命令看起来很安全"），权限系统就可以被构造特定输入的方式绕过。工具作者——不是
   > 模型——才是「这个能力有多危险」的权威判断者。

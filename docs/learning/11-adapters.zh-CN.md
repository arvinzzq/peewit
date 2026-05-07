# 模块 11：@vole/adapters

状态：已完成
日期：2026-05-07

英文版：`11-adapters.md`

相关源码：`packages/adapters/src/index.ts`

## 0. 如何使用本文档

本文档属于学习指南第四阶段（扩展系统）。
请在 [05-tools.zh-CN.md](./05-tools.zh-CN.md) 之后阅读——工具 profile 是本模块的核心概念，
需要先理解工具注册表。

**阅读前**：通读 `packages/adapters/src/index.ts`（123 行）。注意它没有任何运行时逻辑——除
`filterToolsByProfile` 外没有任何执行计算的函数，其余都是类型定义和常量。

**聚焦问题**：
- `AdapterCapabilities` 有三个布尔字段。哪种组合在结构上不可能存在，原因是什么？这个不变量在哪里强制执行？
- `TOOL_PROFILES.full` 的 `allowedTools` 为空数组。`filterToolsByProfile` 如何处理这种情况？为何这是正确的默认值？
- `messaging` profile 没有 `write_file`，`background` profile 没有 `run_shell`。各自针对什么威胁模型？

**检查点**：能够解释为什么本包没有运行时逻辑，以及"选择哪个 profile"的决定实际在哪里发生，即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：把 adapters 想象成挂在房间门口的岗位说明。进入前，每个人都读自己的角色：
"CLI 工程师：可以流式输出、可以提问。""Web 浏览器：同上。""夜班机器人：不能说话，不能提问。"
adapters 包就是这些岗位说明——它不雇人，也不管理房间。

**技术总结**：`@vole/adapters` 是纯声明包。它导出 `AdapterCapabilities`（每个界面能做什么）、
三个能力常量（`CLI_CAPABILITIES`、`WEB_CAPABILITIES`、`BACKGROUND_CAPABILITIES`）、
`ToolProfile`（命名工具集限制）、`TOOL_PROFILES`（四个 profile 定义）、以及
`filterToolsByProfile`（纯过滤函数）。没有来自其他 `@vole/*` 包的导入，没有副作用。

## 2. 为什么这个模块存在

如果没有共享声明包，每个 adapter（CLI、Web、后台）都可能静默地偏离——后台 adapter 可能意外包含
`run_shell`，消息 adapter 可能包含 `write_file`，这些 bug 只有在运行时才会被发现。

通过集中声明，不变量可以一次性测试，到处依赖。架构也获得了统一词汇："这个会话使用 `messaging` profile"
是一个精确、可测试的陈述。

## 3. 公开接口

```ts
// adapter 界面能做什么
interface AdapterCapabilities {
  streaming: boolean;       // 可以实时显示 token_delta 事件
  approvalPrompts: boolean; // 可以显示交互式审批 UI
  background: boolean;      // 可以在没有实时用户连接的情况下运行
}

// 三个能力常量
const CLI_CAPABILITIES:        AdapterCapabilities  // streaming+approvals，非后台
const WEB_CAPABILITIES:        AdapterCapabilities  // streaming+approvals，非后台
const BACKGROUND_CAPABILITIES: AdapterCapabilities  // 仅后台，无 streaming/approvals

// 工具 profile 名称
type ToolProfile = "coding" | "full" | "messaging" | "background"

// Profile 定义
interface ToolProfileDefinition {
  name: ToolProfile
  description: string
  allowedTools: string[]  // 空 = 无限制（full profile）
}

// 所有 profiles
const TOOL_PROFILES: Record<ToolProfile, ToolProfileDefinition>

// 将工具数组过滤为 profile 允许的集合
function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[]
```

## 4. 实现走读

### AdapterCapabilities：不可能的组合

三个布尔值编码了一个结构性不变量：**`background: true` 和 `approvalPrompts: true` 不能同时设置**。
后台 adapter 在无人值守状态下运行——没有用户来回答审批提示。如果后台 adapter 有
`approvalPrompts: true`，任何需要确认的工具调用都会永远阻塞。

测试明确强制执行这个不变量：

```ts
test("a background-capable adapter cannot approve interactively", () => {
  for (const caps of [BACKGROUND_CAPABILITIES]) {
    if (caps.background) {
      expect(caps.approvalPrompts).toBe(false);
    }
  }
});
```

`AdapterStorageType`（`"in-memory" | "jsonl" | "sqlite"`）是描述 session 存储后端的伴生类型，
仅用于信息传递——adapter 不在运行时选择存储，入口点注入 `SessionStore`。

### 工具 profiles：四个命名工具集

| Profile | 用途 | 显著排除 |
|---|---|---|
| `full` | 所有工具可用 | 无——`allowedTools` 为空 |
| `coding` | 文件系统 + Shell 编码任务 | `read_web_page`、`memory_search/get` |
| `messaging` | 只读信息任务 | `write_file`、`run_shell`、`spawn_subagent` |
| `background` | 无人值守后台任务 | `run_shell`、`read_web_page` |

`full` profile 使用空 `allowedTools` 数组作为哨兵值——`filterToolsByProfile` 在数组为空时原样返回输入，
比特殊分支或 `null` 值更简洁。

### filterToolsByProfile：纯泛型过滤

```ts
export function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[] {
  const def = TOOL_PROFILES[profile];
  if (def.allowedTools.length === 0) return tools;
  return tools.filter((t) => def.allowedTools.includes(t.name));
}
```

泛型 `T extends { name: string }`——调用者无需类型转换即可保留具体工具类型。`full` profile 提前返回，
其他所有 profile 按名称成员关系过滤。

### 谁决定使用哪个 profile？

`@vole/adapters` 包声明 profiles 但从不选择。Profile 选择发生在 CLI 入口点：

```ts
// apps/cli/src/index.ts
const filteredTools = config.runtime.toolProfile !== undefined
  ? filterToolsByProfile(allTools, config.runtime.toolProfile as ToolProfile)
  : allTools;
```

Profile 来自 `VOLE_TOOL_PROFILE` 环境变量（通过 `@vole/config`）。未设置时所有工具可用。
这将策略决定保留在入口点，而不是在声明包内部。

## 5. OpenClaw 对齐

| OpenClaw | Vole | 说明 |
|---|---|---|
| 界面能力声明 | `AdapterCapabilities` 常量 | 相同的三布尔模型 |
| 每个界面的命名工具 profile | `TOOL_PROFILES` 记录 | 相同概念；OpenClaw 有更多 profile |
| 基于 profile 的工具过滤 | `filterToolsByProfile` | 相同模式 |
| 后台 adapter 约束 | `BACKGROUND_CAPABILITIES` + 测试不变量 | 相同——后台不能有审批提示 |

## 6. 关键设计决策

**纯声明，无运行时逻辑**

`@vole/adapters` 没有 workspace 包依赖。它不能导入 `@vole/tools`（工具导入能力后会产生循环依赖）。
这种分离也意味着该包可以作为文档阅读：整个 adapter 契约在一个屏幕内呈现。

**`full` 用空数组代替 `null`**

使用空数组作为哨兵避免了可空类型（`string[] | null`），保持 `filterToolsByProfile` 简单。
代价：查看 `TOOL_PROFILES.full.allowedTools` 的调用者看到 `[]` 可能感到困惑，README 和类型文档
对此做了说明。

**不变量通过测试而非类型强制执行**

`background: true` 加 `approvalPrompts: true` 在结构上无效，但 TypeScript 无法用当前的扁平接口
阻止这种情况，改用判别联合类型会使接口和每个调用点都变复杂。测试作为执行点是有意为之的权衡。

## 7. 测试方式

测试在 `packages/adapters/src/index.test.ts` 中。所有测试都是纯常量检查——无文件系统、无异步、无 fake：

- `AdapterCapabilities`：验证三个常量的布尔字段、结构一致性，以及后台不能有审批提示的不变量
- `AdapterStorageType`：验证三个有效字符串字面量
- `TOOL_PROFILES`：验证四个 profile 均存在，`full` 有空 `allowedTools`，每个 profile 包含/排除正确工具
- `filterToolsByProfile`：验证 `full` 返回所有工具，每个受限 profile 正确过滤

## 8. 洞察

**`@vole/adapters` 是一个词汇包。** 它的主要价值不是代码，而是名称和约束。"这个会话使用
`messaging` profile"之所以有意义，正是因为这个包定义了 `messaging` 的含义。没有这个包，
这句话需要检查 CLI 源码中某处的工具列表。

**Profiles 是用途关切，而非权限关切。** `@vole/permissions` 决定特定工具调用在当前自主模式下是否允许。
`@vole/adapters` 决定为这种类型的会话注册哪些工具。两者是正交的：`messaging` 会话仍然对其更小的
工具集运行权限策略。

**该包没有状态，所以没有 bug。** 所有函数都是纯函数，所有导出都是常量。唯一可能的故障是常量中的
错误值，测试会捕获这些。这使 `@vole/adapters` 成为代码库中最稳定的包——它几乎不需要改变。

## 9. 复习问题

1. 为什么 `background: true, approvalPrompts: true` 是不可能的组合？如何强制执行？
   > 后台 adapter 无人值守——没有用户回答审批提示。`approvalPrompts: true` 时，任何需要确认的工具
   > 调用都会永远阻塞。TypeScript 无法用当前扁平接口阻止这种情况，因此测试强制执行：任何
   > `background: true` 的能力常量必须有 `approvalPrompts: false`。

2. `TOOL_PROFILES.full.allowedTools` 是 `[]`。`filterToolsByProfile` 如何处理？
   > 函数检查 `if (def.allowedTools.length === 0) return tools`，原样返回输入。空列表是
   > "无限制"的哨兵值。其他所有 profile 有非空列表，按名称成员关系过滤。

3. `messaging` 排除 `write_file`，`background` 排除 `run_shell`。各自针对什么威胁？
   > `messaging` 排除 `write_file` 是因为其用途是只读信息获取——消息控件或只读聊天机器人
   > 不应修改文件。`background` 排除 `run_shell` 是因为在 `auto` 审批下无人值守的 Shell 执行
   > 风险极高；在没有任何人工监督的情况下运行 Shell 命令的 daemon 可能造成不可逆的损害。

4. 谁决定会话使用哪个 profile，在哪里做出决定？
   > CLI 入口点（`apps/cli/src/index.ts`）读取 `config.runtime.toolProfile`（来自 `VOLE_TOOL_PROFILE`
   > 环境变量）并在完整工具列表上调用 `filterToolsByProfile`。`@vole/adapters` 声明 profiles 但
   > 从不选择。

5. 为什么 `@vole/adapters` 没有 workspace 包依赖？
   > 导入 `@vole/tools` 会在工具需要引用 adapter 类型时产生循环依赖。保持无依赖也意味着 monorepo
   > 中的任何包都可以导入它，不会带来传递依赖。该包是纯声明，不需要运行时导入。

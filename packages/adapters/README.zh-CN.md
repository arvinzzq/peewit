# Adapters Package

English version: [README.md](./README.md)

## 架构概述

`@vole/adapters` 是一个**能力声明包**——不含任何运行时逻辑，只有类型定义、常量和纯过滤函数。其目的是正式定义每个界面 Adapter（CLI、Web、后台任务）能做什么和不能做什么，并定义每种使用场景适合哪些工具。

```
apps/cli        apps/web        后台运行器
    │                │                  │
    └────────────────┴──────────────────┘
                     │  导入
                     ▼
             @vole/adapters
          （能力声明 + 工具配置）
```

通过在一个包中集中这些声明，运行时和 gateway 可以做出路由决策（如"这个 session 支持审批提示吗？"）而无需导入 Adapter 特定代码。

## 核心概念

### AdapterCapabilities

三个布尔标志描述 Adapter 的交互模型：

```typescript
interface AdapterCapabilities {
  streaming: boolean;       // 能否实时显示 token_delta 事件
  approvalPrompts: boolean; // 能否展示交互式审批 UI
  background: boolean;      // 能否在无实时用户连接的情况下运行
}
```

规范常量：

| 常量 | `streaming` | `approvalPrompts` | `background` |
|---|---|---|---|
| `CLI_CAPABILITIES` | `true` | `true` | `false` |
| `WEB_CAPABILITIES` | `true` | `true` | `false` |
| `BACKGROUND_CAPABILITIES` | `false` | `false` | `true` |

由测试强制保护的架构不变量：**后台 Adapter 不能有 `approvalPrompts: true`**，防止后台运行器在无用户时挂起等待审批。

### ToolProfile

`ToolProfile` 限制 session 或任务类型可用的工具集：

| Profile | 适用场景 | 主要工具 |
|---|---|---|
| `"full"` | 所有工具（无限制） | 全部 |
| `"coding"` | 文件系统 + Shell 编码任务 | read_file、list_directory、write_file、run_shell、load_skill、update_todos、spawn_subagent |
| `"messaging"` | 只读信息任务 | read_file、list_directory、read_web_page、memory_search、memory_get、load_skill、update_todos |
| `"background"` | 无人值守后台任务 | read_file、list_directory、write_file、memory_search/get、append_daily_memory、update_todos、spawn_subagent |

`"background"` profile 有意排除 `run_shell` 和 `read_web_page`，因为无人值守时执行 Shell 命令或外部 Web 请求风险更高。

### filterToolsByProfile

```typescript
function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[]
```

泛型纯函数，将具名工具数组按 profile 的 `allowedTools` 列表过滤。`"full"` profile 原样返回输入（不过滤）。泛型保证调用者保留具体的 `ExecutableTool` 类型而无需强转。

### AdapterStorageType

`"in-memory" | "jsonl" | "sqlite"` — 描述 Adapter 使用的存储后端类型。Adapter 不在运行时选择存储——入口点负责配置和注入 `SessionStore`。此类型用于配置和文档说明。

## 实现原理

### 为何有此包

没有共享能力接口时，每个 Adapter 需要定义自己的临时标志，gateway 需要导入 Adapter 特定代码才能回答"session X 支持审批提示吗？"。通过集中于 `@vole/adapters`，gateway 可直接检查 `session.capabilities.approvalPrompts` 而不依赖任何 Adapter 实现。

### 为何工具配置在此

工具配置是 Adapter 层（使用哪个界面）的关注点，而非工具层（存在哪些能力）或权限层（允许哪些调用）。Profile 选择由 Adapter/入口点决定，不由单个工具或权限系统决定。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 adapters 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 adapters 包。 |
| `src/index.ts` | 能力接口和工具配置 | 所有导出：`AdapterCapabilities`、`AdapterStorageType`、三个能力常量、`ToolProfile`、`ToolProfileDefinition`、`TOOL_PROFILES`、`filterToolsByProfile`。 |
| `src/index.test.ts` | 能力和配置测试 | 保护能力常量值、后台不能有审批提示的不变量、四种 profile 定义和 `filterToolsByProfile` 行为。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。

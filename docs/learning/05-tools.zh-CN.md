# 模块 05：@vole/tools

Status: Complete
Date: 2026-05-07

English version: `05-tools.md`

相关源码：`packages/tools/src/index.ts`

## 0. 如何使用本文档

本文档是[学习指南](./guide.zh-CN.md)阶段三（基础层模块）的一部分。在阅读本文档之前，
先读 [04-permissions.zh-CN.md](./04-permissions.zh-CN.md)——你已经知道权限系统根据 `risk`
做决策，而 `risk` 就是在这个包里设置的。

**阅读前**：浏览 `packages/tools/src/index.ts` 中所有 `export function createXxx` 的列表。
注意每个工具的 `risk` 值。然后阅读本文档。

**核心问题**：
- 为什么工具用工厂函数创建而不是单例对象？
- `ToolExecutionContext` 包含什么，为什么这么精简？
- Shell 安全的三层防护分别是什么，各自何时生效？
- 为什么 `edit_file` 要求 `old_string` 在文件中唯一？

**检查点**：当你能追踪一次 `read_file("../../etc/passwd")` 调用在触碰磁盘之前经历的每一
个检查，说明你已经掌握了这个模块。

## 1. 这个模块做什么

**通俗解释**：工具是 agent 的手。没有工具，agent 只能说话——无法读文件、写代码、执行命令
或浏览网页。这个包提供了这些「动手能力」。

但强大的手需要安全手套。这个包里的每个工具都有自己的防护：
- 文件工具检查路径是否在工作区内
- 文件工具拦截访问看起来像密钥的文件名
- Shell 工具拦截最危险的命令模式
- 所有输出都有上限，防止淹没模型的 context

Agent 拿起工具，工具安全地完成工作，返回结构化结果。

**技术说明**：`@vole/tools` 定义了 `ExecutableTool` 接口，提供了 `InMemoryToolRegistry`，
并实现了 13 个内置工具，覆盖文件读写、shell 执行、网页读取、记忆、技能和任务追踪。

它是代码库里唯一执行本地文件系统操作、执行 shell 命令或代表工具发起网络请求的包。

## 2. 为什么它存在

如果工具实现分散在 core 或适配器里，每个适配器都要携带文件系统和 shell 执行逻辑。测试
需要真实文件系统。安全逻辑会散落在代码库各处。

`@vole/tools` 为所有能力创建了单一的、可审计的层。Core 只调用 `tool.execute(input, context)`。
安全检查、路径解析、输出截断和结果归一化都在工具内部发生，对调用方不可见。

## 3. 公开接口

```ts
// 能力契约
interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema   // 输入的 JSON Schema
  risk: ToolRiskLevel            // "low" | "medium" | "high" | "blocked"
}

// 执行时工具收到的——刻意极简
interface ToolExecutionContext {
  workspaceRoot: string
}

// 所有工具结果使用相同形状——错误作为值，不抛出异常
type ToolExecutionResult =
  | ReadFileToolResult          // { ok: true; content; summary }
  | WriteFileToolResult         // { ok: true; summary }
  | ShellToolResult             // { ok: true; exitCode; stdout; stderr; durationMs }
  | ToolExecutionFailure        // { ok: false; error: { code; message } }
  | ...  // 每种工具类型一个变体
```

**内置工具工厂函数**（每个返回 `ExecutableTool`）：

| 工厂函数 | 风险 | 功能 |
|---|---|---|
| `createReadFileTool()` | low | 读取工作区内的 UTF-8 文件 |
| `createListDirectoryTool()` | low | 列出工作区目录内容 |
| `createReadWebPageTool(fetch?)` | low | 获取 URL 并提取纯文本 |
| `createSearchFilesTool()` | low | 在工作区文件中搜索文本（grep 类） |
| `createUpdateTodosTool(onUpdate?)` | low | 替换当前轮次的任务列表 |
| `createLoadSkillTool(skillFileMap)` | low | 按需加载技能完整内容 |
| `createMemorySearchTool(memoryDir)` | low | 在记忆文件中关键词搜索 |
| `createMemoryGetTool(memoryDir)` | low | 读取特定记忆文件 |
| `createWriteFileTool()` | medium | 写入或覆盖文件 |
| `createEditFileTool()` | medium | 精确字符串替换 |
| `createAppendFileTool()` | medium | 追加内容到文件末尾 |
| `createAppendDailyMemoryTool(...)` | medium | 写入当日记忆文件 |
| `createShellTool(options?)` | high | 执行 shell 命令 |

## 4. 实现流程

每个文件工具经过同样的路径：

**第一步 — 解析和验证输入**
`getPathInput(input)` 提取路径字符串。无效输入立即返回 `inputError()`，在任何文件系统
访问之前。

**第二步 — 解析路径并沙箱化**
`resolveWorkspacePath(workspaceRoot, path)` 将路径解析为绝对路径，然后检查结果是否在
工作区根目录内。`../../etc/passwd` 这样的路径解析后在根目录之外，返回 `undefined` →
`outsideWorkspaceError()`。

**第三步 — 检查敏感文件名**
`isSecretLikePath(absolutePath)` 拦截 `.env`、`.env.*`、`.netrc`、`.key`、`.pem`、
`id_rsa`、`id_ed25519` 等。检查基于文件名，不是内容。

**第四步 — 执行文件系统操作**

**第五步 — 返回结构化结果或错误**
所有错误都是 `{ ok: false, error: { code, message } }`，从不抛出异常。

Shell 工具在第一步和第四步之间有额外检查：
- `isBlockedCommand()`：正则黑名单，始终应用
- `isSandboxEscape()`：路径穿越检测，仅 `sandboxed: true` 时启用

## 5. OpenClaw 对照

| OpenClaw | Vole | 备注 |
|---|---|---|
| 内置工具集 | `@vole/tools` 内置工具 | 相同能力类别 |
| 工作区沙箱 | `resolveWorkspacePath` + shell cwd | 类似方式 |
| 敏感文件保护 | `isSecretLikePath` | Vole 特有的启发式列表 |
| `memory_search` / `memory_get` | 对应工厂函数 | OpenClaw 对齐的命名 |
| `update_plan` 工具 | `createUpdateTodosTool` | 相同模式 |

## 6. 关键设计决策

**工厂函数而非单例**

工具在创建时需要注入外部依赖：
- `createReadWebPageTool(fetchFn)` → 测试注入 fake fetch
- `createShellTool({ sandboxed: true })` → 生产环境启用沙箱
- `createMemorySearchTool(memoryDir)` → 运行时特定的路径

单例无法做到这些变化。工厂函数为每个上下文创建配置正确的新工具实例。

**`ToolExecutionContext` 刻意极简**

只有 `workspaceRoot: string`。工具不需要会话数据、模型配置、权限策略或用户上下文。
保持 context 极简让工具可以独立测试，也可以在整个 agent 栈之外复用。

**错误作为值，不抛出异常**

`ToolExecutionResult` 包含 `ToolExecutionFailure: { ok: false; error: { code; message } }`。
工具从不 throw。这与 `@vole/models` 的模式一致——调用方（core）处理所有结果，不需要
包裹每个工具调用的 try/catch。

**`edit_file` 强制 `old_string` 唯一**

`write_file` 替换整个文件——一个错误抹掉所有周围代码。`edit_file` 要求 `old_string`
恰好出现一次（除非 `replace_all: true`）。如果出现多次，工具报错要求提供更多上下文。
这迫使模型做精确的、有针对性的修改，而不是懒惰地重写整个文件。

**输出截断防止 context 淹没**

Shell 输出上限 4000 字符，网页内容上限 8000 字符。超出上限附加 `[truncated N characters]`。
没有这个限制，一个 `cat large_file.log` 就能在一次工具调用里消耗模型的整个 context 窗口。

## 7. 测试方式

测试在 `packages/tools/src/index.test.ts`。所有文件系统操作使用真实临时目录（`mkdtemp`）
——不 mock Node.js 内置模块。

Shell 工具测试使用简单的 `echo` 命令验证执行而不产生副作用。`createReadWebPageTool`
接受可注入的 `fetch` 函数，无需真实 HTTP。

测试类别：
- 工作区沙箱（路径穿越被拦截，根相对路径可用）
- 敏感文件保护（`.env`、`.pem` 被拦截；普通文件允许）
- `edit_file` 唯一性强制（未找到、多次匹配、成功）
- Shell 黑名单（fork bomb、`rm -rf /` 被拦截；安全命令通过）
- Shell 沙箱逃逸检测
- 输出截断
- `update_todos` 校验（至多一个 `in_progress`）

## 8. 关键洞察

**`read_web_page` 是 `low` 风险**，这让新读者感到意外。原因：它是只读的，对本地系统
没有副作用。同样的逻辑适用于 `memory_search` 和 `read_file`。风险追踪的是对本地环境
的潜在危害，不是被访问数据的敏感性。

**Shell 安全是纵深防御，不是安全边界。** 黑名单和沙箱模式是启发式规则——它们捕获常见
错误和明显攻击，不是所有可能的危险命令。真正的安全边界是 `run_shell` 上的 `high` 风险
等级加上权限系统：在 `confirm` 模式（默认）下，每条 shell 命令都需要用户明确批准。

**`edit_file` 优于 `write_file` 做代码修改。** 当模型需要修改 500 行文件里的一个函数，
`write_file` 要求它正确复现所有 500 行。`edit_file` 只需要要替换的精确字符串和替换内容。
这降低了 token 成本，也消除了模型意外遗漏代码的风险。

**`update_todos` 不持有自己的状态。** `onUpdate` 回调是 core 接收更新后 todo 列表的方式。
工具本身在调用之间没有存储状态。状态管理在 `AgentRuntime`（`#currentTodos`）里，不在
工具里。

## 9. 复习问题

1. 为什么工具用工厂函数创建而不是导出预构建的单例实例？
   > 工具在创建时需要注入外部依赖：web 工具需要 fetch 函数，记忆工具需要目录路径，
   > shell 工具需要沙箱配置。工厂函数允许每个消费者为自己的上下文注入正确的依赖。

2. 模型调用 `read_file("../../../etc/passwd")`。在工具尝试读取文件之前，追踪它经历的
   每一个检查。
   > (1) `getPathInput` 提取路径字符串。(2) `resolveWorkspacePath` 将其解析为绝对路径，
   > 然后检查 `relative(workspaceRoot, absolute)` — 结果以 `../../..` 开头，返回
   > `undefined` → `outsideWorkspaceError()`。文件系统从未被触碰。

3. 为什么 `ToolExecutionContext` 这么精简（只有 `workspaceRoot`）？
   > 工具只需要知道工作区在哪里。保持 context 极简让工具无需完整 agent 栈即可独立测试，
   > 也防止工具耦合到会话数据、模型配置或权限策略。

4. `write_file` 和 `edit_file` 有什么区别？分别在什么情况下使用？
   > `write_file` 替换整个文件。`edit_file` 替换精确的字符串出现（必须唯一，或使用
   > `replace_all: true`）。修改现有代码时用 `edit_file`——它保留周围内容，迫使模型精确。

5. 为什么 `read_web_page` 是 `low` 风险，而 `write_file` 是 `medium`？
   > 风险追踪对本地环境的潜在危害。`read_web_page` 是只读的，对本地没有副作用。
   > `write_file` 修改文件系统。风险不是关于被访问数据的敏感性，而是操作可能造成的
   > 本地损害。

6. Shell 安全使用三个机制。分别说明它们以及各自何时生效。
   > (1) 黑名单（`BLOCKED_COMMAND_PATTERNS`）：每条命令都检查的正则模式，始终生效，
   > 拦截 `rm -rf /`、fork bomb、磁盘工具。
   > (2) 沙箱逃逸检测（`SANDBOX_ESCAPE_PATTERNS`）：路径穿越和 `cd /` 模式，仅
   > `sandboxed: true` 时生效。
   > (3) 工作目录：shell 始终以 `cwd = workspaceRoot` 运行，无论其他检查结果如何，
   > 相对路径操作都被限制在工作区内。

7. `update_todos` 有 `onUpdate?: (todos: TodoItem[]) => void` 回调。为什么状态不存储在
   工具本身里？
   > 工具是无状态的——它们产生结果并返回。状态管理属于调用方。`AgentRuntime` 持有
   > `#currentTodos` 并在创建工具时传入回调。这让工具的职责保持精简：校验解析输入，
   > 调用回调，返回 `{ ok: true }`。

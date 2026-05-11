# CLI Adapter

状态：活跃
日期：2026-05-11

English version: [cli-adapter.md](./cli-adapter.md)

## 1. 目的

CLI adapter 是 Vole 第一个面向用户的产品表面。

它让用户可以在终端中开始对话、发送目标、批准动作、检查 trace、恢复 session，并学习 Agent 是如何工作的。

关键边界：

CLI 负责交互。Agent Core 负责行为。

## 2. 为什么这个模块存在

Vole 从 CLI 开始，因为它是最小但有用的产品表面，也是最容易研究 Agent 内部机制的地方。

CLI 仍然必须被认真设计，因为它会塑造早期架构：

- 它不应该直接组装 prompt。
- 它不应该决定模型可以使用哪些 tools。
- 它不应该硬编码 permission policy。
- 它不应该通过自己写 raw files 来持久化 sessions。
- 它应该从结构化 core events 渲染 trace 和 approval state。

这可以避免未来 Web UI、桌面应用和 background runner 变成彼此独立的 Agent 实现。

## 3. 产品目标

MVP CLI 应支持：

- 开始一个交互式 chat session。
- 后续发送一次性 goal。
- 清晰展示模型回复。
- 渲染 explainable trace events。
- 当 tool action 需要批准时询问用户。
- 当 skill system 存在后列出已加载 skills。
- 当 session storage 存在后恢复近期 sessions。
- 提供适合学习的视图，让用户理解 Agent 正在做什么。

CLI 应该像一个可用工具，而不只是 demo wrapper。

## 4. 命令

Phase 1–10 已全部交付。在真实终端（TTY）中，无参数调用默认进入交互式 chat。

Chat：

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `vole` | 无参数调用，stdin 是 TTY 时默认进入交互式 chat | Phase 10 |
| `vole chat` | 使用 configured provider settings 开始交互式 chat | Phase 1 |
| `vole chat --session <id>` | 开始或继续 JSONL-backed named session | Phase 5 |
| `vole chat --resume` | 继续最近更新的 JSONL-backed session | Phase 5 |
| `vole chat --fake-interactive` | 使用 fake provider 本地测试交互 | Phase 1 |
| `vole chat --fake "<message>"` | 一次 fake-provider smoke 测试 | Phase 1 |
| `vole sessions` | 列出已存储 JSONL chat sessions | Phase 5 |
| `vole --version` / `-v` | 显示版本 | Phase 0–1 |
| `vole --help` / `-h` | 显示可用命令 | Phase 0–1 |

后台与自动化：

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `vole run "<goal>"` | 运行一次性后台任务 | Phase 8 |
| `vole run "<goal>" --mode auto\|confirm\|observe` | 设置 run 的自主模式 | Phase 8 |
| `vole run --dream` | 将日记合并进 `MEMORY.md` | Phase 8 |
| `vole tasks [--limit N]` | 列出最近后台任务记录 | Phase 8 |
| `vole daemon` | 启动 cron scheduler daemon | Phase 8 |
| `vole daemon --once` | 一次性执行所有到期任务后退出 | Phase 8 |

跨会话任务图：

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `vole taskflow list [--limit N]` | 列出跨会话任务记录 | Phase 8 |
| `vole taskflow show <id>` | 显示任务记录完整详情 | Phase 8 |
| `vole taskflow cancel <id>` | 将任务标记为 cancelled | Phase 8 |

Skills：

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `vole skills` | 列出已加载技能（workspace > user > built-in） | Phase 3 |
| `vole skills install <path>` | 从 `.md` 文件安装技能 | Phase 9 |
| `vole skills enable <name>` | 重新启用已禁用技能 | Phase 9 |
| `vole skills disable <name>` | 禁用已安装技能 | Phase 9 |
| `vole skills trust <name>` | 信任用户安装的技能 | Phase 9 |
| `vole skills review <name>` | 查看技能完整元数据、权限与正文 | Phase 9 |

Web UI：

| 命令 | 用途 | 阶段 |
| --- | --- | --- |
| `vole web [-p PORT]` | 启动捆绑的 web 仪表板（默认端口 3120） | Phase 6 |
| `vole web --no-open` | 不自动打开浏览器 | Phase 6 |

## 5. 交互式 Chat

`vole chat` 是 MVP 的主要工作流。

预期行为：

1. 加载配置。
2. 对 configured provider path 要求 `VOLE_API_KEY` 或 `OPENROUTER_API_KEY`。
3. 创建或恢复一个轻量 session。
4. 为每个 user turn 创建 run ID。
5. 将用户消息发送给 Agent Core。
6. 流式输出或打印 assistant output。
7. 当 trace events 到达时渲染它们。
8. 当 core 报告 approval request 时询问 permission。
9. 当 storage 存在后持久化 session 和 trace data。

Configured chat 默认把 messages 存入 `~/.vole/sessions` 下的 JSONL session files。Named sessions 使用 `--session <id>`，并且必须使用 safe session IDs。`--resume` 会选择最近更新的 stored session 并继续它。默认 session IDs 使用通用的 `session_<id>` 形态，因为 sessions 属于 Agent，而不是某个特定 adapter。

CLI 不应该知道 prompt 是如何组装的。它可以展示 context package 生成的 summary 或 report。

## 6. Slash 命令

在交互式 chat 中，slash commands 提供本地控制，避免把所有指令都发送给模型。

MVP slash 命令：

| Slash 命令 | 用途 |
| --- | --- |
| `/help` | 显示 chat 控制说明 |
| `/exit` | 结束 session |
| `/trace` | 显示近期 explainable trace events |
| `/config` | 显示脱敏后的 effective configuration |
| `/skills` | 列出已加载 skills，包括来源和触发条件 |
| `/clear` | 清空终端显示，而不是清空 session history |

未来 slash 命令：

| Slash 命令 | 用途 |
| --- | --- |
| `/context` | 显示 context assembly summary |
| `/session` | 显示当前 session metadata |
| `/mode observe|confirm|auto` | 支持 autonomy mode 后切换模式 |
| `/model <name>` | provider switching 存在后切换模型 |

Slash 命令应由 CLI adapter 处理。它们应该调用结构化 package APIs，而不是直接编辑内部状态。

## 7. 输出模型

CLI 应渲染四类输出：

- Assistant 消息
- Trace events
- Permission prompts
- 本地命令结果

这些类别在终端中应该有清晰区分。具体样式可以演进，但源数据应保持结构化。

MVP output 应优先清晰，而不是装饰。

## 8. Trace 渲染

Trace output 是学习体验的一部分。

默认 MVP 行为：

- 内联显示 compact trace events。
- 默认隐藏 raw provider messages。
- 显示 tool names 和安全 summary，而不是完整 unsafe payloads。
- 清晰展示 permission decisions。
- 在上下文中展示 errors。

`/trace` 应显示当前 session 的近期 trace details。

后续 `vole trace <session>` 可以在 session 结束后检查已存储 traces。

## 9. Permission Prompts

CLI 不决定某个动作是否允许。

流程：

```text
Agent Core requests tool action
  -> Permission policy evaluates action
  -> Core emits approval request if needed
  -> CLI renders prompt
  -> User approves or denies
  -> CLI sends decision back to core
```

MVP prompt options：

- 本次批准
- 拒绝
- 查看详情

未来选项：

- 在本 session 中批准类似动作
- 批准匹配 project policy 的命令
- 批准前编辑 tool input

Approval choices 必须在 trace 中可见。

## 10. 配置

CLI 通过共享 configuration layer 读取配置。

配置可能包括：

- Model provider
- Model name
- API base URL
- Workspace path
- Default autonomy mode
- Trace verbosity
- Session storage location

Secrets 应来自环境变量或安全的本地 secret mechanism，而不是 workspace prompt files。

CLI 可以通过 `vole config` 展示生效的非 secret 配置。

## 11. 自主性模式

CLI 暴露 autonomy mode，但 permission package 定义该模式的含义。

初始模式：

- `observe`：任何 external action 前都询问。
- `confirm`：允许 low-risk actions，并对 medium 或 high-risk actions 询问。
- `auto`：减少打断，但仍遵守 blocked 和 high-risk policy。

默认 MVP mode 应为 `confirm`。

## 12. Session 行为

Phase 1 可以从 ephemeral sessions 开始。

当 session storage 存在后，CLI 应支持：

- 命名或生成 session IDs。
- Session listing。
- Session resume。
- Trace inspection。
- 每个 turn 都有一致的 run IDs。

CLI 应使用 session package，而不是直接写 session files。

## 13. 错误处理

CLI 应让可恢复错误容易理解。

示例：

- 缺少 API key：说明需要哪个环境变量或配置值。
- Provider error：展示简洁原因，以及可用时的 trace event ID。
- Permission denial：尽可能继续 session。
- Tool failure：展示安全 summary，并让 core 决定下一步。
- Invalid slash command：展示 local help。

发生在 agent run 内的 errors 应在 trace 中可见。

## 14. Streaming

如果能简化实现，MVP 可以先使用 non-streaming responses。

接口应为 streaming 留出空间：

- Assistant text streaming。
- Trace events 在 tokens 之间到达。
- Permission prompts 中断一次 run。
- 长操作期间 cancellation。

Streaming 不应改变 package boundaries。

## 15. CLI 渲染框架

**Phase 6 已交付。** 交互式聊天（`vole chat` 与无参数 `vole`）使用 **Ink**（[npmjs.com/package/ink](https://www.npmjs.com/package/ink)）渲染——一个基于 React 的终端 UI 框架。Ink 路径位于 `apps/cli/src/app.tsx`，由 `main()` 通过动态 `import()` 加载，仅当需要真实 TTY 交互 session 时启用；非交互场景（测试、`--fake`、脚本、管道 stdin、`sessions`/`run` 等子命令）仍走 `apps/cli/src/index.ts` 中基于 readline 的路径。

采用 Ink 的原因：

- Streaming token 输出在同一终端区域原地更新，而不是不断追加新行。
- Tool 进度指示器（spinner、步骤计数）在多步 run 期间实时更新。
- Permission prompts 可以是一个完整块，展示风险说明、输入预览和审批控件。
- Slash 命令的 picker（`/resume`）使用方向键选择会话列表。
- OpenClaw 本身就使用 Ink，保持架构对齐。

Ink 路径仅限于 `apps/cli/src/app.tsx`。Agent Core、context assembly、tools、permissions 和 session packages 完全不受影响。Adapter 的逻辑：

1. 检测 stdin 是否是 TTY，以及子命令是否是 `chat`（或没有子命令——bare `vole`）。
2. 满足时动态 import `./app.js` 并调用 `runInkChat()`。
3. 否则路由到 `runCli()`，使用基于 readline 的路径以兼容测试/脚本。

`runInkChat()` 构造 `CliChatSession`、在进程内 `SessionGateway` 中注册，并渲染 `<ChatApp>`，该组件处理 streaming、todos 面板、approval modal 和 slash 命令。

## 16. 无参数调用

`vole` 无子命令时默认进入交互式 chat，但仅当 `process.stdin.isTTY === true` 时。非 TTY 场景（管道 stdin、CI、脚本）会落到 commander 路径，commander 会打印帮助。这避免了在测试 harness 或 pipeline 中无意启动 chat 进程。

供测试使用的 `runCli` 库函数同样会在无参数调用时短路到 `runInteractiveConfiguredChat`，让 readline-based 测试路径获得相同的逻辑行为而不必依赖 Ink。

## 17. Cancellation

CLI 最终应支持取消 active run。

MVP cancellation 可以是 best-effort：

- 尽可能停止后续 model 或 tool steps。
- 在 trace 中把 run 标记为 canceled。
- 保持 session history 一致。

Run queue 拥有 run state。CLI 只发送 cancellation request。

## 18. 与 Agent Core 的关系

CLI 将 user input 和 local decisions 发送给 Agent Core。

CLI 接收：

- Assistant output events
- Trace events
- Approval requests
- 完成状态
- 错误状态

CLI 不能代表模型直接调用 tools。

## 19. 与 Web UI 的关系

CLI 是第一个 adapter。它应该证明 adapter boundary。

Web UI 后续需要的一切，都应该已经有非视觉等价物：

- User message submission
- Trace event 渲染
- Permission approval
- Session selection
- Configuration display
- Run cancellation

如果某个行为无法在不依赖终端假设的情况下表达，它很可能属于 adapter layer。

## 20. 测试要求

CLI adapter tests 应聚焦用户可见工作流和边界。

必需测试领域：

- 命令解析
- `chat` 启动流程
- Session listing 和 resume behavior
- Slash 命令处理
- Permission prompt 渲染和决策转发
- 基于结构化 events 的 trace 渲染
- 错误渲染
- 通过共享 APIs 加载配置
- 确保 CLI 不直接 import provider SDKs
- 确保 CLI 不直接 assemble prompts
- 确保 CLI 不为 model-requested actions 直接 execute tools

任何改变 Agent Core events、permission prompts、trace events、session handling 或 context reports 的迭代，都应更新 CLI adapter tests。

## 21. 验收标准

MVP CLI adapter 成功标准：

- `vole chat` 可以启动一个可用的 interactive session。
- User messages 通过稳定 adapter API 到达 Agent Core。
- Assistant responses 清晰渲染。
- Trace events 可见且适合学习。
- Permission prompts 工作正常，同时不把 policy 移入 CLI。
- CLI 不拥有 prompt assembly、tool selection、provider logic、permission policy 或 session persistence rules。
- CLI behavior 有聚焦测试覆盖。

## 22. 相关文档

- [Main design](../product/vole-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Project Structure](./project-structure.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Run Queue](./run-queue.zh-CN.md)
- [Session Storage](./session-storage.zh-CN.md)

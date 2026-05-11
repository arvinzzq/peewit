# 模块 14：apps/cli

状态：已完成
日期：2026-05-07

英文版：`14-cli.md`

相关源码：`apps/cli/src/index.ts`

## 0. 如何使用本文档

本文档属于学习指南第五阶段（系统综合）。
请最后阅读——`apps/cli` 是所有其他模块的组装点。阅读前应已理解 `@vole/core`、
`@vole/sessions`、`@vole/tools`、`@vole/config`、`@vole/skills`、`@vole/scheduler`、
`@vole/gateway` 和 `@vole/adapters`。

**阅读前**：grep 文件中的 `CliChatSession`，追踪两个工厂方法（`createFake` 和
`createConfigured`）。然后读 `sendMessage`——这是 CLI 中最重要的方法。最后追踪 `runCli`
了解命令路由。

**聚焦问题**：
- `RunCliOptions` 有六个可注入字段。每个字段在测试中 fake 了什么真实能力，生产默认值是什么？
- `CliChatSession.createConfigured` 组装了八个包。列出每个并解释它提供了什么。
- `sendMessage` 对三种不同事件类型有特殊处理。各是什么，各持久化什么？
- Slash 命令在两个层次处理。哪些命令直接在循环中处理，哪些委托给 `CliChatSession.runSlashCommand`？为什么分开？

**检查点**：能够描述从命令行 `vole chat` 到第一个 assistant 响应出现在终端的完整路径，
命名每个被触及的包，即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：CLI 是剧院制作的舞台监督。所有其他模块都是专业人员：灯光组（`@vole/models`）、
道具部（`@vole/tools`）、剧本监督（`@vole/context`）、舞台日志（`@vole/sessions`）。
舞台监督不做他们的工作——它知道该叫谁、以什么顺序调用，并在幕布升起前将所有人连接起来。

**技术总结**：`apps/cli` 是终端适配器。它暴露 `runCli` 作为主入口点，路由到子命令（`chat`、
`run`、`sessions`、`tasks`、`skills`、`daemon`、`taskflow`）。适配器的核心是 `CliChatSession`，
一个组装带有所有依赖的 `AgentRuntime` 的类——模型 provider、工具、context 组装器、session store、
审批 resolver、skill 索引、gateway——并驱动交互式 turn 循环。所有外部 I/O（readline、stdout、
fetch）都是可注入的，使整个 CLI 无需终端即可测试。

## 2. 架构：依赖组装

`CliChatSession.createConfigured` 是系统的主要接线点。它在一个函数中调用了八个包：

```
loadConfig()              → @vole/config    – 经验证的运行时设置
SkillLoader.load()        → @vole/skills    – skill 定义 + skill 索引
createCliBuiltInTools()   → @vole/tools     – 所有可用工具
createCliApprovalResolver → 内联            – 交互式 readline resolver
createConfiguredProvider  → @vole/models    – Anthropic 或 OpenRouter provider
createCliContextAssembler → @vole/context   – 带工作区文件的 DefaultContextAssembler
JsonlSessionStore         → @vole/sessions  – 消息 + trace 持久化
SessionGateway.register   → @vole/gateway   – 注册 session 为活跃
filterToolsByProfile      → @vole/adapters  – 应用 VOLE_TOOL_PROFILE 限制
AgentRuntime              → @vole/core      – agent 循环
```

代码库中没有其他文件触及所有这十个包。CLI 是整个系统的唯一组装点。

## 3. 公开接口

```ts
// 所有外部 I/O——完全可注入用于测试
interface RunCliOptions {
  env?: Record<string, string | undefined>  // 覆盖 process.env
  fakeModelOutputs?: ModelOutput[]          // 使用 FakeModelProvider
  fetch?: FetchLike                         // 覆盖全局 fetch
  readLine?: (prompt: string) => Promise<string | undefined>  // stdin
  sessionsDirectory?: string                // 覆盖 sessions 路径
  write?: (text: string) => void            // stdout
}

// 每个 CLI 命令的返回值
interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

// 主入口点——对 args 的纯函数
async function runCli(args: string[], packageVersion: string, options?: RunCliOptions): Promise<CliResult>

// 交互式 session 对象
class CliChatSession {
  static createFake(...): CliChatSession        // 测试工厂
  static async createConfigured(...): Promise<CliChatSession>  // 生产工厂
  async sendMessage(message, opts?): Promise<CliChatTurnResult>
  async runSlashCommand(command): Promise<string[]>
  close(): void
}
```

## 4. 实现走读

### runCli：命令路由器

```ts
export async function runCli(args, packageVersion, options = {}): Promise<CliResult> {
  const [command, ...rest] = args;
  if (command === "chat")     return runInteractiveConfiguredChat(options, parsedArgs);
  if (command === "run")      return runBackgroundTask(...);
  if (command === "sessions") return runListSessions(options);
  if (command === "tasks")    return runListTasks(options, limit);
  if (command === "skills")   return runSkillsCommand(rest, options);
  if (command === "daemon")   return runDaemon(options, once);
  if (command === "taskflow") return runTaskflowCommand(rest, options);
  if (command === "gateway")  return runGatewayStatus(options);
}
```

纯派发——路由器本身没有业务逻辑。每个分支返回带 `exitCode`、`stdout`、`stderr` 的 `CliResult`。
整个 CLI 是一个从 args 到结果的函数，使其极易测试。

`vole gateway status`（Phase 11 Step 6）打印两个视图：当前 CLI 调用的进程内 gateway 状态（lane 占用、活跃 run —— 一次性 CLI 调用通常为空）；以及跨进程视图，扫描 sessions 目录下其他 vole 进程留下的 `.lock` 旁车文件，读取它们的 pid + startedAt，将每条标为 `alive` 或 `stale`。两视图组合：lane 在一个 Node 进程内排序写入；文件锁与 `.lock` 视图在多进程间排序写入。

### RunCliOptions：六个可注入接缝

| 字段 | 生产默认值 | 它 fake 了什么 |
|---|---|---|
| `env` | `process.env` | 不触碰真实环境的配置加载 |
| `fakeModelOutputs` | 真实模型 provider | 确定性模型响应 |
| `fetch` | 全局 `fetch` | 无网络的网页读取 |
| `readLine` | stdin 的 `readline` | 测试中的交互输入 |
| `sessionsDirectory` | 来自配置 | 每个测试独立的 session 存储 |
| `write` | 缓冲到 stdout | 测试中捕获流式输出 |

每个测试将 `readLine` 设置为返回预设消息序列，`write` 设置为捕获输出。无终端、无 API 密钥、无文件系统副作用。

### CliChatSession：两个工厂方法

**`createFake`** — 同步，使用 `FakeModelProvider`、`InMemorySessionStore`。用于交互循环的单元测试。

**`createConfigured`** — 异步，完整生产设置：
1. 验证 API 密钥存在
2. 从工作区加载 skills → 构建 skill 索引 + skill 文件映射
3. 创建真实模型 provider（Anthropic 或 OpenRouter）
4. 构建所有工具 → 应用 profile 过滤
5. 为 `spawn_subagent` 创建 `SubagentFactory`
6. 在 `cliGateway` 中注册 session
7. 用所有内容构建 `AgentRuntime`

### sendMessage：turn 引擎

Phase 11 Step 5a 起，聊天 run 提交给 `GatewayCore` 而非直接调用 `runtime.runTurn`。Gateway 把 run 穿过 `@vole/lanes` 定义的三层 lane 链（global / subagent / session），并把用户提供的 `opts.signal` 接到 `gateway.cancel(runId)`，让 Ctrl+C 中止干净流转：

```ts
async sendMessage(message, opts = {}): Promise<CliChatTurnResult> {
  const recentMessages = await this.#sessionStore.listMessages(this.#sessionId);
  const runId = `run_${crypto.randomUUID()}`;

  if (this.#gateway && opts.signal) {
    opts.signal.addEventListener("abort", () => this.#gateway.cancel(runId), { once: true });
  }

  const eventStream = this.#gateway
    ? this.#gateway.submit<RuntimeEvent>({
        runId,
        sessionKey: this.#sessionId,
        agentId: "default",
        run: async function* (signal) {
          for await (const event of runtime.runTurn({ sessionId, recentMessages, message, signal })) {
            yield event;
          }
        }
      })
    : this.#runtime.runTurn({ sessionId, recentMessages, message, signal: opts.signal });

  for await (const event of eventStream) {
    await this.#traceStore.append(event);
    await this.#sessionStore.appendTraceEvent({ sessionId, event });
    events.push(event);
    opts.onEvent?.(event);

    // 处理压缩持久化
    if (event.type === "compaction_triggered" && event.summary) {
      await this.#sessionStore.appendCompactBoundary({ ... });
    }

    // 处理消息持久化
    if (event.type === "turn_complete") {
      for (const msg of event.messages) {
        await this.#sessionStore.appendMessage({ ... });
      }
    }
  }
}
```

三种特殊事件：
1. **每个事件** → 追加到 `traceStore` 和 `sessionStore` 作为 trace 记录
2. **`compaction_triggered`** → 向 session JSONL 写入 `compact_boundary` 记录
3. **`turn_complete`** → 持久化本次 turn 的所有消息（用户 + 工具调用 + 工具结果 + assistant）

这是 `@vole/core` 的事件流被翻译为 `@vole/sessions` 持久化的地方。Gateway 在调用路径上是薄编排层 —— 它不改写事件。`createFake` 测试路径不传 gateway，因此 `sendMessage` 回落到直接调用 `runtime.runTurn`。

### Slash 命令：两个层次

**循环层**（直接在 `runInteractiveLoop` 中处理）：
- `/exit` — 跳出循环
- `/clear` — 打印清屏通知
- `/help` — 内联打印帮助

**Session 层**（委托给 `CliChatSession.runSlashCommand`）：
- `/trace` — 从 session store 读取 trace 事件，渲染紧凑 trace
- `/config` — 渲染脱敏配置
- `/skills` — 渲染 skill 索引

分开的原因：循环层命令不需要 session 状态，而 session 层命令需要访问 `#sessionStore`、`#config`
或 `#skillDefinitions`。

### createCliApprovalResolver：交互式审批

```ts
function createCliApprovalResolver(options, approvalPromptLog) {
  return {
    async resolve(request) {
      approvalPromptLog.push("Approval required:", `Tool: ${request.call.name}`, ...);
      const answer = await options.readLine?.("Approve once? [y/N/details] ");
      if (answer === "y" || answer === "yes") {
        return { approved: true, reason: "Approved once from CLI prompt." };
      }
      return { approved: false, reason: "Denied from CLI prompt." };
    }
  };
}
```

使用 `options.readLine`——在测试中可注入。审批决策被推入 `approvalPromptLog`，
测试可以断言什么被提示了。注意：提示文字中的 `"details"` 选项尚未实现。

### Session 恢复

`vole chat --resume` 调用 `findMostRecentSessionId`，列出所有 session 并选择最近更新的一个。
Session ID 随后传给 `createConfigured`，后者创建预填充了现有 session 消息的 `JsonlSessionStore`。
agent 通过 `sendMessage` 中的 `recentMessages` 接收完整消息历史。

## 5. 关键设计决策

**所有 I/O 可注入——CLI 是纯函数**

`runCli` 通过 `RunCliOptions` 接受所有 I/O。没有直接的 `console.log`，没有直接的 `process.stdin`。
这是使 CLI 可测试的关键设计决策：测试套件导入 `runCli` 并用所有 I/O 的 fake 实现调用它。
1600 行 CLI 代码无需真实终端即可覆盖。

**`CliChatSession` 将构建与使用分离**

构建（两个工厂方法）组装所有依赖。`sendMessage` 方法假设所有内容已经接好线。这使得通过
`createFake` 单独测试 `sendMessage`，以及单独测试 `createConfigured` 中的组装逻辑变得容易。

**审批是单次触发，非 session 持久**

CLI 审批 resolver 在用户键入 `y` 时批准单个工具调用。它不在工具调用或 turn 之间记住审批。
这符合最小权限原则：每个潜在危险的动作都需要单独的决策。

**`approvalPromptLog` 是共享数组，而非事件**

审批 resolver 推入可变数组，`sendMessage` 对其切片以找到当前 turn 的审批。这比将审批提示事件
发送到事件流更简单，代价是可组合性较低。对单 adapter 系统来说是务实的选择。

**压缩和消息持久化在 adapter 层发生，而非 core 层**

`@vole/core` 发出 `compaction_triggered` 和 `turn_complete` 事件。`sendMessage` 响应这些事件
并调用 session store。这意味着持久化策略存在于 CLI adapter 中——如果不同 adapter 想要不同的
持久化行为，它会以不同方式处理事件。Core 保持纯粹：它发出事件，不写文件。

## 6. 测试方式

测试在 `apps/cli/src/index.test.ts`（514 行）中。所有测试使用 `RunCliOptions` 注入：

- 无真实 `process.env` — 传入 `{ env: { ANTHROPIC_API_KEY: "..." } }`
- 无真实模型 — 传入 `fakeModelOutputs` 或使用 `CliChatSession.createFake`
- 无真实文件系统 — 传入 `sessionsDirectory` 指向临时目录
- 无真实 stdin — 传入 `readLine` 返回预设消息序列
- 无真实 stdout — 传入 `write` 捕获到字符串数组

## 7. 洞察

**`apps/cli` 是系统变成现实的地方。** 所有其他包都是抽象。`apps/cli` 是 `EffectiveConfig`
变成真实 `AgentRuntime` 的地方，是 `JsonlSessionStore` 获得真实文件路径的地方，是 `SkillLoader`
获得真实工作区根目录的地方。阅读 `createConfigured` 就是阅读系统的组装手册。

**可注入 I/O 模式使测试驱动的 CLI 开发成为可能。** 因为 `runCli` 是 `(args, version, options)`
的纯函数，添加新命令的流程是：写处理函数，在 `runCli` 中加分支，写测试调用 `runCli` 并断言 `stdout`。
无终端，无环境，无时序。

**`CliChatSession` 不是 Ink 组件。** Ink 是基于 React 的终端渲染库。Vole 的 CLI 通过可注入的
`write` 函数使用纯文本输出。这使 CLI 比 OpenClaw 的终端 UI 视觉效果更简单，但更容易测试和推理。
`write` 函数用格式化字符串调用，终端看到的正是 `write` 接收到的内容。

**Slash 命令分层是一种分层纪律。** 需要 session 内部状态的命令（`/trace`、`/config`、`/skills`）
在 `CliChatSession` 中，因为它们访问私有字段。纯循环控制命令（`/exit`、`/clear`、`/help`）
留在循环中，因为它们不需要 session 状态。将循环控制命令移入 `CliChatSession` 会把 session
内部状态暴露给循环；将 session 命令移入循环需要把私有字段传出来。

## 8. 复习问题

1. 列出六个 `RunCliOptions` 字段以及各自在生产中替换的内容。
   > `env`：替换 `process.env` 用于配置加载。`fakeModelOutputs`：用 `FakeModelProvider` 替换
   > 真实模型 provider。`fetch`：替换全局 `fetch` 用于网页读取。`readLine`：替换 stdin readline
   > 用于交互输入。`sessionsDirectory`：用测试临时目录替换配置派生的 sessions 路径。`write`：
   > 用可在测试中捕获的函数替换缓冲 stdout 写入。

2. `sendMessage` 中收到 `compaction_triggered` 事件时会发生什么？
   > 如果事件有非空 `summary`，`sendMessage` 调用 `sessionStore.appendCompactBoundary`，
   > 传入摘要和消息计数。这向 session JSONL 写入 `compact_boundary` 记录。下次 session 加载时，
   > `JsonlSessionStore` 中的 `#replay` 会遇到这个 boundary，丢弃之前的所有消息，并将摘要作为
   > system 消息插入——agent 看到的是压缩后的历史。

3. 为什么 `createConfigured` 是异步的，而 `createFake` 是同步的？
   > `createConfigured` 调用 `SkillLoader.load()`，后者从磁盘读取 skill 文件——一个异步文件系统
   > 操作。`createFake` 使用 `InMemorySessionStore` 和进程内的 `FakeModelProvider`，两者都不
   > 需要 I/O。

4. `/trace` 是 `CliChatSession` 中的 slash 命令，但 `/exit` 在 `runInteractiveLoop` 中处理。为什么？
   > `/trace` 需要访问 `this.#sessionStore` 来调用 `listTraceEvents`，这是 `CliChatSession` 的
   > 私有字段。`/exit` 只需要跳出循环——不需要 session 状态。把 `/exit` 放进 `CliChatSession`
   > 需要把 session 内部状态暴露给循环，或给 `runSlashCommand` 加上"是否退出"的返回值。

5. `SubagentFactory` 是什么，为什么在 `createConfigured` 内部创建？
   > `SubagentFactory` 是一个只有一个方法的接口：`create(goal): AgentRuntime`。它传给
   > `createSpawnSubagentTool`，后者在 agent 调用 `spawn_subagent` 时调用 `factory.create(goal)`。
   > 在 `createConfigured` 内部创建是因为子 agent 继承父 agent 的模型 provider、context 组装器、
   > 工作区根目录和工具集——所有这些都在 `createConfigured` 中组装。在其他地方创建的工厂无法
   > 访问这些依赖。

# Vole Agent — 深度学习指南

Status: Draft
Date: 2026-05-07

English version: [guide.md](./guide.md)

## 1. 目标

本指南是从零开始理解 OpenClaw 风格 agent 架构的学习课程，以 Vole 代码库作为学习载体。

配套文档 [plan.md](./plan.md) 是按包依赖顺序排列的模块参考表。本指南不同：它按概念阶段
组织，先建立心智模型，再深入源码。

每完成一个阶段，按照[模块文档模板](./_template.zh-CN.md)产出对应的学习文档。这些文档是
学习过程的持久化输出——任何人都可以直接阅读它们，而不必重新走一遍源码。

预计学习时长：5 个阶段，共 20–26 小时。

## 2. 前置条件

- 能读 TypeScript：class、interface 定义、async/await
- 用过至少一次 LLM API（调用过 Claude 或 GPT 即可）

不需要事先了解 agent 系统，这正是本指南要教的。

## 3. 学习方法

每个阶段遵循同样的四步模式：

1. **为什么** — 这个阶段建立什么心智模型
2. **阅读什么** — 按顺序阅读的具体文件
3. **问自己** — 阅读时需要找到答案的问题
4. **动手** — 一个具体的练习，验证理解

按顺序学习，不要跳跃。架构文档解释代码*为什么*是这个形状。没有"为什么"，实现看起来就
是随意的。

每完成一个模块，用 `_template.zh-CN.md` 写一篇模块学习文档。随着时间积累，这些文档会成
为团队理解系统的权威说明。

## 4. 阶段一：什么是 Agent？

### 4.1 为什么先学这个

聊天机器人发送消息、得到回复。Agent 可以*主动选择采取行动*、观察结果、然后决定下一步——
在一个循环里。这个区别是根本性的。

Vole 代码库里的所有东西，都是为了让这个循环：安全（权限系统）、可见（追踪）、可持久
（会话）、可扩展（工具、技能、适配器）。

这个阶段只建立心智模型，不看代码。

### 4.2 阅读清单

1. `docs/architecture/agent-loop.md` — 第 1–4 节
2. `docs/research/openclaw-implementation-notes.md` — 第 1–3 节
3. `docs/architecture/openclaw-architecture-map.md` — 第 1–4 节

按顺序读。每节读完后停下来想一想，再继续。

### 4.3 核心问题

在进入阶段二之前，回答这些问题：

- Agent 和单次 LLM API 调用有什么本质区别？
- OpenClaw 文档中，agent loop 的五个阶段是什么？
- 权限系统为什么必须存在？没有它会出什么问题？
- 为什么每一次循环都要重新组装 context，而不是缓存上一次的？

### 4.4 动手练习

不打开任何代码：在纸上画出 agent loop。画出：用户、模型、权限检查、工具、观察结果。画
箭头表示数据流向。标注每个节点可能让循环停下来的情况。

画完后，重读 `agent-loop.md` 第 2 节，修正你的图。

---

## 5. 阶段二：核心循环

### 5.1 为什么先读 core？

`@vole/core` 是整个系统的中心。其他所有包要么为这个循环服务，要么刻意不碰它。先读
core——在完全理解它的所有依赖之前——能让你看到整体框架。你不会看懂每一行，这完全没关系。
目标是看清形状。

### 5.2 阅读清单

1. `docs/architecture/agent-loop.md` — 第 15 节（接口定义和事件类型）
2. `packages/core/src/index.ts` — 公开导出接口
3. `packages/core/src/` — 所有实现文件
4. `packages/core/src/index.test.ts` — 先读测试名称和断言

### 5.3 核心问题

- 17 个 `RuntimeEventType` 值是什么？一次正常运行中，它们以什么顺序出现？
- 为什么 `runTurn` 返回 `AsyncGenerator<RuntimeEvent>` 而不是 `Promise<RuntimeEvent[]>`？
- 权限评估在循环的哪个位置发生？
- `ContextAssembler` 是什么？为什么是注入到 `AgentRuntime` 而不是在内部创建？
- 什么触发 `planning_stall_detected`？触发后发生什么？

### 5.4 动手练习

运行项目：

```sh
pnpm install
cd apps/cli && pnpm dev
```

向 agent 提问："列出当前目录的文件。"

然后找到 `packages/core/src/` 中的 `runTurn` generator。在每个 `yield` 语句前加一行
`console.error` 打印事件类型。用同样的问题再跑一次 CLI。在控制台观察事件序列。
完成后删掉这些日志。

---

## 6. 阶段三：基础层模块

对下面每个模块，目标是理解*它解决了什么问题*以及*它在哪里插入循环*。从"如果这个包不存在
会发生什么？"这个问题开始每个模块的学习。

完成每个子阶段后，用 `_template.zh-CN.md` 产出 `docs/learning/NN-<name>.zh-CN.md（N 为学习步骤编号）`。

### 6.1 Models — 模型抽象层

**为什么**：如果 `@vole/core` 直接调用 Anthropic SDK，每次换模型都要改循环。`ModelProvider`
把厂商逻辑隔离在一个包里。

**阅读**：`packages/models/src/`，`docs/architecture/model-provider.md`

**问自己**：`ModelProvider` 暴露了哪些方法？`StreamingModelProvider` 额外加了什么？
`FakeModelProvider` 做了什么真实 provider 不需要做的事？token 计数在哪里发生？

**动手**：打开 `AnthropicProvider` 和 `FakeModelProvider`，写下它们共有的方法签名。比较
两者的 `generate()` 实现。fake 跳过了什么，为什么？

---

### 6.2 Permissions — 安全门控

**为什么**：模型可以请求任何已注册的工具。没有门控，一个有问题的 prompt 就能删文件或泄露
密钥。`PermissionPolicy` 在每次工具调用执行之前进行评估。

**阅读**：`packages/permissions/src/`，`docs/architecture/permission-system.md`

**问自己**：四种决策（allow / ask / deny / block）分别是什么？谁调用 `evaluate()`？当结果
是 `ask` 时，谁和用户交互——是 permissions 包吗？

**动手**：写一个新的 `PermissionPolicy`（草稿文件里就行），对 `risk: "high"` 的工具返回
`{ decision: "ask" }`，对其他所有工具返回 `{ decision: "allow" }`。只要满足 TypeScript
接口，不需要运行它。

---

### 6.3 Tools — Agent 的手

**为什么**：工具是 agent 在世界中采取行动的方式。每个工具有名称、描述、JSON schema、
风险级别和执行函数。工具系统负责注册、校验和执行。

**阅读**：`packages/tools/src/`，`docs/architecture/tool-system.md`

**问自己**：`ExecutableTool` 是什么，有哪些字段？`ToolExecutionContext` 是什么，在执行时
给工具提供什么？谁在执行前校验输入 schema？

**动手**：找一个读文件的工具和一个执行 shell 命令的工具。比较它们的 `risk` 值。找到
`ToolExecutionContext` 在哪里被构造，以及它包含什么。

---

### 6.4 Context — 模型看到的一切

**为什么**：模型只知道被告知的内容。每次调用模型都需要组装完整的 context：系统提示、
对话历史、工具描述、技能索引、工作区文件。`@vole/context` 负责这个组装过程。

**阅读**：`packages/context/src/`，`docs/architecture/prompt-assembly.md`，
`docs/architecture/context-engine.md`

**问自己**：系统提示由哪些节组成？`ContextSkillSummary` 是什么，它和完整技能体有什么区别？
缓存提示（cache hinting）是什么，为什么能降低 API 成本？

**动手**：找到组装好的 context 被传给 `ModelProvider` 的地方。加一个临时日志打印系统提示
的各节名称。运行 CLI 并观察输出。

---

### 6.5 Sessions — 跨轮次记忆

**为什么**：从模型视角看，每次 API 调用都是无状态的。会话把消息历史和追踪事件持久化到磁盘，
在下一轮开始时重新加载，给 agent 提供连续性。

**阅读**：`packages/sessions/src/`，`docs/architecture/session-storage.md`

**问自己**：每个会话持久化了什么？mutex 是做什么的，没有它会怎样？compaction 何时触发？
`TraceEvent` 和 `ModelMessage` 有什么区别？

**动手**：用 CLI 进行一个 3 条消息的对话。在磁盘上找到会话文件。打开它。它是什么格式？
追踪部分存了什么？

---

### 6.6 TaskFlow — 轮内进度追踪

**为什么**：执行复杂任务时，用户需要看到进度。`update_todos` 工具让模型在单个 turn 内
传达当前步骤——结构上与 Claude Code 的 `TodoWrite` 完全相同。

**阅读**：`packages/taskflow/src/`，`docs/research/openclaw-implementation-notes.md` 第 7 节

**问自己**：`update_todos` 和 OpenClaw 的完整持久化 `TaskFlow` 注册表有什么区别？模型什么
时候调用它？更新后谁读取 todo 状态？

**动手**：让 CLI agent 做一个多步任务。观察 todo 的更新。阅读 `packages/taskflow/src/`，
看工具是如何每次调用都替换整个列表的。

---

## 7. 阶段四：扩展系统

阶段四涵盖在基本工具调用之外扩展循环的包。每个子阶段后，产出对应的模块学习文档。

### 7.1 Skills — 动态行为扩展

**为什么**：技能为 agent 提供针对特定任务类型的专项指令。不将所有技能体注入每个提示（成本
太高），而是加载一个紧凑索引，只在触发时才读取完整技能体——渐进式披露。

**阅读**：`packages/skills/src/`，`docs/architecture/skill-system.md`，`skills/` 目录

**问自己**：技能 frontmatter 包含哪些字段？完整技能体什么时候加载，什么时候只用索引？谁
决定一个技能是否与当前任务相关？

**动手**：阅读 `skills/` 目录中的一个 `SKILL.md` 文件。识别每个 frontmatter 字段。在草稿
位置写一个只有 `name` 和 `description` 的最小技能文件。

---

### 7.2 Adapters — 工具配置文件

**为什么**：不同场景需要不同的工具集。编程 agent 需要文件和 shell 访问。消息 agent 不应该
执行 shell 命令。工具配置文件定义每种场景下实例化哪些工具。

**阅读**：`packages/adapters/src/`，`docs/architecture/adapters.md`

**问自己**：三种配置文件（`coding`、`full`、`messaging`）分别是什么？每种包含哪些工具？
这个包强制执行了什么架构边界？

**动手**：找到每种配置文件的工具列表定义位置。列出 `coding` 中有但 `messaging` 中没有的
工具。用一句话解释每个被排除的原因。

---

### 7.3 Scheduler — 后台运行

**为什么**：Agent 不只是交互式的。调度器允许按 cron 计划或事件触发运行 `AgentRuntime`，
无需人类在线。

**阅读**：`packages/scheduler/src/`，`docs/architecture/background-automation.md`

**问自己**：cron 触发器如何持久化？如果下一个触发器到来时上一次运行还没结束会发生什么？
调度器如何与 gateway 交互？

**动手**：阅读调度器中关于触发器的测试文件。从触发器创建到第一次 `AgentRuntime.runTurn()`
调用，追踪完整的生命周期。

---

### 7.4 Gateway — 入口守卫

**为什么**：多个适配器可能同时尝试启动同一会话的运行。Gateway 是单一入口点，强制执行
每个会话的串行化，防止并发运行。

**阅读**：`packages/gateway/src/`，`docs/architecture/gateway.md`

**问自己**：`createSession` 做什么？`resumeSession` 有什么不同？并发运行防护在哪里实现？
`runId` 是什么，谁创建它？

**动手**：阅读 gateway 源码。找到防止并发运行的锁或 mutex。从一个进来的会话请求追踪到
第一次 `AgentRuntime.runTurn()` 调用。

---

## 8. 阶段五：系统综合

### 8.1 与 OpenClaw 对比

完整重读 `docs/research/openclaw-implementation-notes.md`。对每个 OpenClaw 概念，找到 Vole
的对应实现，记录下来：

| OpenClaw 概念 | Vole 对应实现 | 阶段 | 备注 |
|---|---|---|---|
| `agent-command.ts` | `AgentRuntime` | Phase 1 | |
| `pi-embedded-runner.ts` | `@vole/core` 循环 | Phase 1 | |
| `session-store.ts` | `@vole/sessions` | Phase 5 | |
| `update_plan` tool | `update_todos` | Phase 4 | |
| `lanes.ts`（会话队列） | `@vole/gateway` | Phase 7 | |
| `incomplete-turn.ts` | core 中的 stall 检测 | Phase 4 | |

根据阶段二到四学到的知识，补全表格其余部分。

### 8.2 架构决策记录

阅读 `docs/decisions/`。对每条决策记录，回答：

- 被拒绝的替代方案是什么？
- 为什么被拒绝？
- 这个决策给未来阶段施加了什么约束？

### 8.3 哪些被推迟了，为什么

回顾 `docs/roadmap/overview.md` 和 `docs/architecture/openclaw-architecture-map.md`。一些
OpenClaw 功能被刻意推迟到后续阶段。

对每个被推迟的功能，用一句话说明：它做什么、为什么不在 MVP 里、Vole 哪个阶段引入它。

---

## 9. 附录：阅读技巧

**从 `index.ts` 开始**：每个包的公开契约就是它的导出。先读导出，再读实现。

**测试是文档**：测试名称是对行为最诚实的描述。先读测试名称和断言，再读实现。

**先跟类型**：先读 `interface` 和 `type` 定义，再读 `class` 实现体。接口描述模块承诺了
什么，类描述怎么兑现承诺。

**用 grep 找调用者**：想知道"谁调用了 X？"，运行 `grep -r "X" packages/ apps/`。调用处
揭示为什么某个东西存在。

**完整追踪一条路径**：不要广度优先读完整个 `@vole/core`，而是完整追踪一个具体输入的路径。
跟着"用户请求执行 bash 命令"走过每个函数调用，直到工具结果被 yield 回模型。

**产出文档**：每个模块学完后，写 `docs/learning/NN-<name>.zh-CN.md（N 为学习步骤编号）`。写作这个动作强制理解。
如果你无法解释一个设计决策，说明你还没真正理解它。

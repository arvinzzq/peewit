# Workspace Files

状态：草案
日期：2026-05-02

English version: [workspace-files.md](./workspace-files.md)

## 1. 目的

Workspace files 是 OpenClaw-like Agent 存放 instructions、identity、memory 和 environment notes 的可见、可编辑表面。

Vole 应支持这种模型，因为它让 Agent 行为可检查、可学习。

核心规则：

Workspace files 可以影响 Agent 行为，但不能绕过 tools、permissions、redaction 或 trace。

## 2. 为什么这个模块存在

OpenClaw 使用 workspace files 作为 Agent home 的核心部分。

Vole 需要清晰的 workspace-file policy，以便：

- Prompt loading 可预测。
- 用户可以检查和编辑 Agent context。
- Memory 可见，而不是隐藏在 opaque state 中。
- 敏感文件不会被意外注入。
- Identity files 受到保护，不会被静默修改。
- 未来 gateway 和 background runs 共享同一套 context rules。

## 3. 计划文件

Vole 应逐步支持这些 OpenClaw-like files。

| 文件 | 用途 | MVP 状态 |
| --- | --- | --- |
| `AGENTS.md` | 运行规则和项目指令 | 早期 |
| `SOUL.md` | Agent identity、values、tone 和 boundaries | Phase 1-2 |
| `USER.md` | 用户偏好和持久个人上下文 | Phase 5 |
| `MEMORY.md` | 整理后的长期记忆 | Phase 5 |
| `memory/YYYY-MM-DD.md` | 每日笔记和近期观察 | Phase 5 |
| `TOOLS.md` | 环境和工具说明 | Phase 5-6 |
| `HEARTBEAT.md` | 后台自动化指令 | Phase 8 |
| `BOOTSTRAP.md` | 启动引导上下文 | 暂缓 |

MVP 不应自动加载所有文件。

## 4. 工作区位置

Vole 应区分：

- Workspace directory：可编辑 agent/project context
- User data directory：sessions、credentials、cache、local state

建议默认值：

```text
<project>/
  AGENTS.md
  skills/
  vole.config.json

~/.vole/
  sessions/
  config.json
```

Credentials 和 secrets 不应存在于 workspace prompt files 中。

## 5. 加载阶段

Workspace files 应分阶段引入。

### MVP / Phase 1

加载：

- `AGENTS.md`，如果存在
- Read-only `SOUL.md`，如果存在

不加载：

- `USER.md`
- `MEMORY.md`
- Daily memory files

### Phase 1-2

完善 prompt-file security、redaction 和 trace visibility。

### Phase 5

在明确 memory policy 后增加：

- `USER.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

### 后续阶段

当 background 和 tool systems 就绪后增加：

- `TOOLS.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`

## 6. 文件职责

### `AGENTS.md`

包含 operational rules 和 project instructions。

示例：

- 如何运行 tests
- Coding conventions
- Project-specific constraints
- Documentation policy
- Commit policy

`AGENTS.md` 可以由 users 或 project maintainers 编辑。

### `SOUL.md`

定义 Agent identity：

- 价值观
- 语气
- 沟通风格
- 边界
- 与 memory 和成长的关系

从 Agent 角度看，`SOUL.md` 默认应是 read-only。Agent self-modification 应要求明确用户批准。

Phase 5 会在 configured workspace root 下存在这些文件时，将 `AGENTS.md` 和 `SOUL.md` 读入 context。文件不存在时会省略，不会导致 chat startup 失败。

### `USER.md`

存储 durable user preferences 和 personal context。

它可能包含敏感信息，所以 automatic writes 应延后到 privacy 和 approval policy 就绪后。

### `MEMORY.md`

存储 curated long-term memory。

它应包含 durable facts、decisions、preferences 和 project knowledge。它不应变成 raw transcript dump。

### `memory/YYYY-MM-DD.md`

存储 daily notes 和 recent observations。

Daily notes 可以帮助连接 short-term 和 long-term memory，但不应被当作自动可信真相。

### `TOOLS.md`

记录 environment 和 tool notes。

它可以包含：

- 可用命令
- 环境特性
- 工具限制
- 安全使用说明

它不能包含 secrets。

### `HEARTBEAT.md`

记录 background automation behavior。

在 background automation 和 run queue policies 稳定前，它不应激活。

### `BOOTSTRAP.md`

提供 startup bootstrap context。

这应该延后，因为 uncontrolled bootstrap context 很容易成为 prompt-injection surface area。

## 7. 加载顺序

未来 OpenClaw-like loading order：

```text
Base system instructions
  -> AGENTS.md
  -> SOUL.md
  -> USER.md, if enabled
  -> MEMORY.md, if enabled
  -> Recent daily memory, if enabled
  -> TOOLS.md, if enabled
  -> Session resume context
  -> Skill index
  -> Tool definitions
  -> User message
```

MVP order 应保持更小：

```text
Base system instructions
  -> AGENTS.md, if enabled
  -> Runtime metadata
  -> Permission guidance
  -> Skill index
  -> Tool definitions
  -> Session resume context
  -> User message
```

Loading order 必须测试。

## 8. 写入策略

Workspace files 应有明确 write policies。

| 文件 | 默认 Agent 写入策略 |
| --- | --- |
| `AGENTS.md` | 询问 |
| `SOUL.md` | 高风险询问，或默认阻止 |
| `USER.md` | 高风险询问 |
| `MEMORY.md` | 询问；涉及个人事实时需要更强确认 |
| `memory/YYYY-MM-DD.md` | 询问，或按配置允许 |
| `TOOLS.md` | 询问 |
| `HEARTBEAT.md` | 高风险询问 |
| `BOOTSTRAP.md` | 高风险询问，或默认阻止 |

MVP 中任何 workspace prompt file 都不应被 Agent 静默修改。

## 9. 风险分类

建议 permission risks：

- 读取 `AGENTS.md`：低风险
- 读取 `SOUL.md`：低风险或中风险，取决于 privacy policy
- 读取 `USER.md`：中风险或高风险
- 读取 `MEMORY.md`：中风险
- 写入 `SOUL.md`：高风险
- 写入 `USER.md`：高风险
- 写入 `MEMORY.md`：中风险或高风险
- 写入 daily memory：中风险
- 写入类似 secret 的内容：阻止

这些 risks 应在实现阶段细化。

## 10. 脱敏

Workspace file content 进入 model context 前，redaction 应扫描：

- API keys
- Tokens
- Private keys
- Credentials
- Secret-like patterns
- Excessively large content

如果内容被 redacted，trace 和 prompt assembly report 应记录发生了 redaction。

## 11. Prompt 注入风险

Workspace files 是强大的 prompt surfaces。

风险：

- `AGENTS.md` 中的 malicious instruction
- `SOUL.md` 中的 accidental unsafe instruction
- `MEMORY.md` 中的 memory poisoning
- `USER.md` 中的 secret exposure
- `TOOLS.md` 中的 tool misuse instructions

缓解：

- Clear loading order
- File-specific trust levels
- 脱敏
- Permission policy
- Trace visibility
- Hostile file content tests

## 12. Trace 要求

Workspace file loading 应在 trace 中可见。

Trace 应包含：

- File path
- 是否找到文件
- 是否加载
- 是否 redacted
- 是否 truncated
- 如果 omitted，为什么 omitted

Trace 不应展示完整敏感内容。

## 13. 与 Memory 的关系

Workspace files 不全是 memory。

- `SOUL.md` 是 identity。
- `AGENTS.md` 是 instruction。
- `USER.md` 是 user context。
- `MEMORY.md` 是 curated long-term memory。
- Daily memory files 是 recent notes。

保持这些概念分离，可以防止 memory 变成无结构杂物箱。

## 14. 与 Context Engine 的关系

Context engine 决定哪些 workspace files 进入一次 run。

Workspace file loading 应：

- Explicit
- Ordered
- Bounded
- Redacted
- Trace-visible
- Tested

Prompt assembly 将选中的 workspace file content 格式化为 model input。

## 15. 测试要求

Workspace files 需要安全导向测试。

必需测试领域：

- 文件发现
- 加载顺序
- 文件不存在时的行为
- 超大文件截断
- 脱敏
- Prompt 注入回归用例
- 写入权限分类
- 只读 identity policy
- Load/omit/redact/truncate 的 trace entries
- Context assembly 集成

任何改变 prompt assembly、memory、permissions 或 context engine behavior 的迭代，都应更新 workspace file tests。

## 16. 验收标准

Workspace file design 成功标准：

- 每个 planned file 都有 documented purpose。
- MVP loading scope 小且明确。
- Future loading order 被记录。
- 每个文件都有 write policy。
- 每类文件都有 risk classification。
- Prompt injection 和 redaction risks 被记录。
- Loading behavior 有清晰测试要求。

## 17. 相关文档

- [Prompt Assembly](./prompt-assembly.zh-CN.md)
- [Context Engine](./context-engine.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [Memory System](./memory-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [OpenClaw Architecture Map](./openclaw-architecture-map.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)

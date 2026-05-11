# Tool Profiles

状态：设计
日期：2026-05-11

English version: [tool-profiles.md](./tool-profiles.md)

## 1. 目的

并非每次 agent 运行都需要所有 tools。后台摘要 agent 不需要 shell 执行。消息机器人不需要文件写入访问。将所有 tools 注入每个 prompt 会浪费 tokens，并创建不必要的攻击面。

Tool profiles 定义命名的能力集，确定给定 session 或运行可用哪些 tools。它们配置一次，并在 permission system 评估单个 tool 调用之前应用。

核心规则：

Tool profiles 缩小范围。它们从不授予超出 permission policy 允许的权限。从 profile 中排除的 tool 无论权限级别如何都无法被调用。

## 2. Profile 类型

Vole 定义四种内置 profile 类型：

```typescript
type ToolProfile = "coding" | "full" | "messaging" | "background";
```

| Profile | 使用场景 |
| --- | --- |
| `coding` | 自主编码任务：读/写文件、运行 shell、运行测试 |
| `full` | 通用交互式 session：所有已注册 tools |
| `messaging` | 基于 channel 的通信：仅读取 tools，无 shell，无文件写入 |
| `background` | 定时或后台任务：只读子集，无交互式审批 |

## 3. Profile 定义

| Tool | coding | full | messaging | background |
| --- | --- | --- | --- | --- |
| `read_file` | 是 | 是 | 是 | 是 |
| `list_directory` | 是 | 是 | 是 | 是 |
| `write_file` | 是 | 是 | 否 | 否 |
| `run_shell` | 是 | 是 | 否 | 否 |
| `read_web_page` | 是 | 是 | 是 | 是 |
| `web_search` | 是 | 是 | 是 | 是 |
| `append_daily_memory` | 否 | 是 | 否 | 是 |
| `update_todos` | 是 | 是 | 否 | 否 |
| `load_skill` | 是 | 是 | 否 | 是 |
| `sessions_spawn` | 否 | 是 | 否 | 否 |

注意：

- `background` profile 禁用 shell 和文件写入，因为后台任务不应触发交互式审批提示。
- `messaging` profile 是只读的，以防止基于 channel 的 agents 产生文件系统副作用。
- `coding` profile 是最窄的可写 profile：包含 shell 和文件写入，但不包含 memory 或 sub-agent 生成。
- `full` profile 包含所有已注册 tools，是交互式 CLI session 的默认值。

可以通过向 profile registry 添加条目来定义自定义 profiles。自定义 profile 名称不能与内置名称冲突。

## 4. Profile 选择

Profile 选择优先级：

1. `RunOptions` 中的显式 `profile` 字段
2. Session 的 adapter 类型的默认 profile（CLI → `full`，background → `background`，messaging → `messaging`）
3. 配置中的全局默认：`tools.defaultProfile`

如果任何地方都未指定 profile，使用 `full`。

```typescript
interface RunOptions {
  profile?: ToolProfile | string; // 内置或自定义 profile 名称
  // ...
}
```

Profile 在 `runTurn()` 开始时解析一次，并在上下文组装之前应用于过滤 tool registry。这确保被过滤的 tools 不会出现在模型的 system prompt 中。

## 5. 与 Permissions 的交互

Tool profiles 和 permission system 是互补的层：

- **Profile** 控制运行中哪些 tools 可见且可调用。
- **Permission policy** 控制可见 tool 的动作是否被允许、需要确认或被阻止。

不在活动 profile 中的 tool 对模型不可见：它不出现在 system prompt 中，无法被调用，也不会被 permission system 评估。

在 profile 中的 tool 仍受正常的 permission 评估约束。Profile 包含不绕过风险分类或用户审批。

评估顺序：

```
1. Profile 过滤 → 可见 tool 集
2. Permission policy → 每次 tool 调用的 allowed / confirm / block
```

## 6. OpenClaw 对齐

OpenClaw 为每个 channel 和每种运行类型定义能力集。关键对齐：

| OpenClaw 概念 | Vole 等效 |
| --- | --- |
| 每 channel tool 集 | 每 adapter 类型的 `ToolProfile` |
| 编码能力集 | `"coding"` profile |
| 后台能力集 | `"background"` profile |
| 在 permission 前应用 tool 集 | Permission 评估前的 profile 过滤 |

OpenClaw 的实现确认，profile 限制比单独依赖 permissions 进行范围缩减更简单且更安全。

## 7. 验收标准

Tool profiles 在满足以下条件时视为完成：

- 四种内置 profiles 按第 3 节描述的 tool 集定义。
- `RunOptions.profile` 为运行选择活动 profile。
- 不在活动 profile 中的 tools 从 system prompt 中排除，无法被调用。
- 如果未配置显式 profile，分配 adapter 默认 profiles。
- Permission system 对活动 profile 中的 tools 不受影响。
- 单元测试覆盖：profile 过滤应用、adapter 默认分配、自定义 profile 注册。

## 8. 相关文档

- [Tool System](./tool-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Execution Contract](./execution-contract.zh-CN.md)
- [Background Automation](./background-automation.zh-CN.md)
- [Adapters](./adapters.zh-CN.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)

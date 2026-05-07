# Permission System

状态：草案
日期：2026-05-02

English version: [permission-system.md](./permission-system.md)

## 1. 目的

Permission System 决定某个具体 Agent 动作是否允许运行。

Vole 会随着时间变得越来越有能力，但能力越强，风险越高。Permission System 是让 Agent 能行动、同时让用户保持控制的边界。

核心规则：

模型可以请求一个动作，工具可以知道如何执行它，但 Permission System 决定这个动作是否允许。

## 2. 为什么这个模块存在

通用 Agent 可以接触文件、运行命令、访问 Web，并最终自动化后台任务。没有 Permission System，每个新能力都会增加意外破坏或意外行为的概率。

Permission System 给 Vole 提供：

- 跨工具的一致安全模型
- 支持不同自主模式的方式
- 可追踪记录，说明为什么动作被允许或阻止
- 工具能力与用户批准之间的清晰边界
- 未来 plugin 和 skill 信任决策的基础

## 3. 风险等级

MVP 权限使用四个风险等级。

| 风险 | 含义 | 默认行为 |
| --- | --- | --- |
| Low | 在正常 workspace 使用中预期安全 | 在 `confirm` 和 `auto` 中自动允许 |
| Medium | 可以改变本地状态或访问更广上下文 | 需要确认 |
| High | 可以造成显著变化、运行代码或暴露数据 | 需要带风险说明的明确确认 |
| Blocked | 已知危险或敏感动作 | 默认拒绝，除非显式允许 |

风险等级不只是工具的属性。它们也取决于工具输入、workspace、配置和自主模式。

## 4. 风险分类示例

| 动作 | 风险 | 原因 |
| --- | --- | --- |
| 列出 workspace 内文件 | Low | 只读且有范围限制 |
| 读取 workspace 内 `README.md` | Low | 只读且有范围限制 |
| 读取 `.env` | Blocked | 可能包含密钥 |
| 写入新的文档文件 | Medium | 改变本地状态 |
| 修改源代码 | Medium | 改变项目行为 |
| 运行 shell 命令 | High | 执行代码或系统命令 |
| 运行 `rm -rf` | Blocked | 破坏性命令 |
| 读取公开网页 | Low | 只读外部访问 |
| 将文件内容提交到远程服务 | High | 可能暴露用户数据 |

## 5. 自主模式交互

自主模式会改变用户被打断的频率，但不会移除权限检查。

### `observe`

最适合学习和调试。

预期行为：

- 在大多数动作前暂停。
- 展示计划动作。
- 展示风险分类。
- 等待用户确认。

### `confirm`

MVP 默认模式。

预期行为：

- Low risk 动作可以自动运行。
- Medium 和 High risk 动作需要确认。
- Blocked actions 被拒绝，除非显式允许。

### `auto`

用于可信自动化。

预期行为：

- Low 和已配置的 Medium risk 动作可以自动运行。
- High risk 动作仍可能需要确认，除非 policy 允许。
- Blocked actions 仍保持 blocked，除非显式允许。

## 6. 权限决策形态

实现计划阶段会细化具体类型，但架构预期的 decision 形态类似：

```ts
type PermissionDecision =
  | { type: "allow"; risk: RiskLevel; reason: string }
  | { type: "ask"; risk: RiskLevel; reason: string; prompt: string }
  | { type: "deny"; risk: RiskLevel; reason: string };
```

Decision 应包含人类可读 reason，以便出现在 execution trace 和 approval prompt 中。

## 7. 权限评估输入

权限评估应考虑：

- Tool name
- Tool input
- Tool default risk metadata
- Workspace root
- Current working directory
- 目标文件路径或 URL
- Autonomy mode
- 用户和项目配置
- 当前 session 中的 previous approvals
- 动作是否匹配 allowlists 或 blocklists

模型的信心或措辞不足以批准一个动作。

## 8. 批准流程

Permission System 不直接询问用户。它向 Agent Core 返回 decision。

批准流程：

```text
ToolAction
  -> PermissionPolicy.evaluate
  -> allow: execute tool
  -> ask: adapter asks user
  -> deny: record denial observation
```

Adapter 负责呈现：

- CLI 在终端询问。
- Web UI 展示 approval panel。
- Background automation 记录 pending approval 或安全停止。

## 9. Trace 要求

每个非平凡权限决策都应该出现在 execution trace 中。

Trace entry 应包含：

- Tool/action name
- Risk level
- Decision type
- Reason
- 是否请求了用户批准
- 用户批准或拒绝

这对安全和学习都很重要。用户应该能理解为什么 Agent 停止或继续。

## 10. 配置

MVP 配置可支持：

- Default autonomy mode
- Workspace root
- Enabled tools
- Blocked path patterns
- Allowed path patterns
- Shell command timeout
- 后续 phase 中可选 shell allowlist

敏感设置不应保存在项目配置中。

## 11. Workspace 边界

Workspace 边界是权限评估的核心。

默认 policy：

- Workspace 内只读动作通常可以是 Low risk。
- Workspace 内写入通常是 Medium risk。
- 访问 workspace 外应是 Medium 或 High risk。
- 类似 secret 的文件默认 Blocked。

Secret-like files 示例：

- `.env`
- `.npmrc`
- SSH keys
- Cloud credential files
- 匹配已配置 secret patterns 的文件

## 12. Shell 安全

Shell 执行应一开始就是 High risk。

系统应记录：

- Command
- Working directory
- Purpose summary
- Risk explanation
- Timeout

未来版本可增加：

- Safe command allowlist
- Dangerous command denylist
- Sandboxed command execution
- Project-specific shell policies

## 13. Session Approvals

后续版本可以允许临时批准，例如：

- 只允许这一次精确动作
- 本 session 内允许此工具
- 本 task 内允许写入此目录

MVP 可以从 one-time approvals 开始。这在系统早期更容易推理，也更安全。

## 14. 测试要求

Permission System 需要强测试，因为它保护高风险行为。

必需测试领域：

- 常见文件动作的风险分类
- Secret path blocking
- Workspace boundary handling
- Shell command 默认 High risk 行为
- Blocked command behavior
- 自主模式差异
- Approval decision shape
- Allow、ask、deny decisions 的 trace entries
- 针对任何新发现不安全 case 的回归测试

任何改变 tools、configuration、autonomy modes 或 adapter approval behavior 的迭代，都应该包含 Permission tests。

## 15. 验收标准

MVP Permission System 成功标准：

- 每次 tool call 在执行前都经过评估。
- 支持 Low、Medium、High、Blocked decisions。
- `confirm` 模式自动允许 Low risk actions，并询问 Medium/High。
- Blocked actions 默认拒绝。
- Shell commands 默认需要明确确认。
- Secret-like paths 默认 blocked。
- Permission decisions 在 execution trace 中可见。
- Permission behavior 被 unit 和 integration tests 覆盖。

## 16. 相关文档

- [主设计](../product/vole-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Tool System](./tool-system.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)

# Phase 2 Tools and Permissions Plan

状态：活跃
日期：2026-05-11

English version: [phase-2-tools-and-permissions.md](./phase-2-tools-and-permissions.md)

## Progress

状态：Complete

已完成：

- Tool definition contracts 和 in-memory registry：`4ae3515`
- Permission decision types 和 default policy：`6ccb737`
- Runtime emits model-requested tool-call events：`0055ee8`
- Runtime evaluates permission decisions for requested tool calls：`0a0f18b`
- CLI renders approval prompts for `ask` permission decisions：`6c3b956`
- Runtime approval resolver records approval request and resolution events：`7e81d92`
- Executable tool contracts and built-in read-only file tools：`099e037`
- Runtime executes registered tools and sends observations back to the model：`5ee7791`
- CLI registers built-in read-only file tools in runtime composition：`19c9ab3`
- read_file secret 文件拦截、read-only 工具安全回归测试、guarded write_file 工具：`8e82a36`
- CLI 注册 write_file 工具：`b497623`
- Guarded shell tool（含 blocked patterns、timeout 和 captured output）：`1c7a231`
- CLI 注册 shell tool：`7abb38b`
- read_web_page tool（含 HTML extraction、truncation 和 injectable fetch）：`417ed8e`
- CLI 注册 read_web_page tool：`0e0946b`
- ModelInput tool definitions、OpenAICompatibleProvider tool_calls 响应解析：`4bf6c78`
- 真正的 agent while loop（multi-round tool calling + maxSteps 限制）：`1aaa7b8`

剩余：

无。Phase 2 已完成。

下一步建议阶段：

- Phase 3：Lightweight skills — 加载本地 SKILL.md 文件并影响 agent 行为。

## 1. 目的

Phase 2 给 Vole 增加第一批真实外部动作能力。

目标是让 Agent 可以检查文件、在批准后写文件、在批准后运行 shell commands，并通过安全的 tool 和 permission boundaries 读取 Web 内容。

核心规则：

Model-requested actions 在经过 validation、permission、execution 和 trace 前都是不可信的。

## 2. 用户结果

Phase 2 完成后，用户应该可以：

- 让 Agent 检查 workspace 中的文件。
- 让 Agent 列目录。
- 批准文件写入。
- 批准 shell commands。
- 让 Agent 搜索或读取已配置 Web 内容。
- 在 trace output 中看到 tool calls 和 permission decisions。

## 3. 范围

Phase 2 包括：

- Tool interface 和 registry。
- 内置 file tools。
- 内置 shell tool。
- 根据 provider readiness，加入 basic web search 或 web page reader。
- Tool input validation。
- Permission risk classification。
- CLI permission prompts。
- Tool trace events。
- Safety regression tests。

Phase 2 不包括：

- Full sandboxing。
- Browser automation。
- Remote tool nodes。
- Long-term memory tools。
- Background automation tools。
- Plugin-provided tools。

## 4. 计划工作

推荐顺序：

1. 添加 tool domain types 和 registry。
2. 添加用于 runtime tests 的 fake tools。
3. 添加 permission decision types 和 policy。
4. 使用 fake model output 将 tool-call handling 接入 AgentRuntime。
5. 添加 CLI approval prompt flow。
6. 添加 file read 和 directory list tools。
7. 添加需要确认的 file write tool。
8. 添加需要确认、带 timeout 和 captured output 的 shell tool。
9. 通过 configured provider 添加 web search 或 page reader。
10. 添加 tool lifecycle 和 permission decisions 的 trace events。
11. 添加 safety regression tests。

每一步都应保持系统可运行。

## 5. Tool Registry

Tool registry 应支持：

- 注册 built-in tools。
- 按名称查找 tool。
- 为 model projection 列出 tools。
- 为 CLI display 列出 tools。
- 暴露 trace-friendly metadata。

Agent Core 应使用 registry，而不是 hard-code tools。

## 6. Tool Interface

第一版实现应支持：

- Tool name
- Description
- Input schema
- Default risk metadata
- Validation
- Execution
- Normalized result

精确 TypeScript shape 可以参考 [Architecture Contracts](../architecture/contracts.zh-CN.md)，但实现可以调整细节。

## 7. File Tools

初始 file tools：

- `list_directory`
- `read_file`
- `write_file`

规则：

- 默认使用 workspace boundary。
- Permission evaluation 前先 normalize paths。
- 将 likely secret files 视为 blocked。
- 对 large outputs 进行 truncation 或 summary。
- 在 trace 中记录 file path、action 和 result summary。

`write_file` 默认需要确认。

## 8. Shell Tool

初始 shell tool 行为：

- 默认 High risk。
- 需要明确确认。
- 在 configured workspace 或 working directory 中运行。
- 捕获 stdout、stderr、exit code 和 duration。
- 强制 timeout。
- 在可行时阻止 known destructive command patterns。
- 在 trace 中记录 command summary。

Shell output 很大时，应先 summary 后再进入 model context。

## 9. Web Tools

Web support 可以从两种方式之一开始：

- 如果用户提供 URLs，先做 `read_web_page`。
- 如果已配置 search provider，先做 `web_search`。

两种路径都应该：

- 保留 source URLs。
- Normalize fetch/search errors。
- 避免发送 secrets。
- 在 trace 中记录 source metadata。
- 可以从 config 中轻松关闭。

具体 first provider 可以在实现阶段选择。

## 10. Permission Policy

MVP permission policy 应支持：

- `allow`
- `ask`
- `deny`

Risk levels：

- Low
- Medium
- High
- Blocked

`confirm` 模式默认行为：

- Low risk：auto-allow。
- Medium risk：ask。
- High risk：ask，并带更强 risk explanation。
- Blocked：deny。

## 11. CLI Approval Flow

当 tool action 需要 approval 时，AgentRuntime 发出 approval request。

CLI 应展示：

- Tool name。
- Action summary。
- Risk level。
- Permission reason。
- Relevant path、URL 或 command。
- Available choices。

MVP choices：

- 本次批准。
- 拒绝。
- 查看详情。

Session-level approvals 可以延后。

## 12. Trace Events

Phase 2 应增加 trace events，例如：

- `tool_call_requested`
- `tool_input_validated`
- `tool_call_permission_evaluated`
- `approval_requested`
- `approval_resolved`
- `tool_started`
- `tool_completed`
- `tool_failed`
- `tool_denied`

Trace 应展示发生了什么，同时不暴露 raw secrets 或过量 output。

## 13. Context Integration

Context assembler 应在 model input 中包含 tool definitions。

它不应包含：

- Tool implementation details。
- Secret configuration。
- Permission bypass instructions。

Permission guidance 可以作为 policy summary 加入，但模型不能给自己授予 permission。

## 14. 测试

Phase 2 必需测试：

- Tool registry lookup and listing。
- Unknown tool rejection。
- Tool input validation failure。
- Workspace 内 file read。
- Secret-like file blocked。
- Workspace 外 path 被分类为更高风险。
- File write requires approval。
- Shell command requires approval。
- Dangerous shell pattern denied or blocked。
- Tool result normalization。
- Permission decision trace events。
- CLI approval prompt forwards approve and deny decisions。
- AgentRuntime handles fake tool calls end to end。
- 如果包含 web tools，测试 web tool error normalization。

常规测试不应运行 destructive commands，也不应需要 network access。

## 15. 验证命令

Phase 2 应以等价于以下内容的检查结束：

```text
typecheck
unit tests
integration tests
safety regression tests
CLI approval flow smoke test
documentation checks
```

Network-dependent web tests 应是 opt-in，或使用 fixtures。

## 16. Commit Plan

建议小粒度 commits：

1. `feat(tools): add tool registry`
2. `feat(permissions): add permission policy`
3. `feat(core): handle model tool calls`
4. `feat(cli): add approval prompts`
5. `feat(tools): add file read and list tools`
6. `feat(tools): add guarded file write`
7. `feat(tools): add guarded shell tool`
8. `feat(tools): add web read capability`
9. `test: cover tool and permission safety`

如果实现过程中发现更好的依赖顺序，具体顺序可以调整。

## 17. 验收标准

Phase 2 完成标准：

- Tools 可以注册，而不需要改变 Agent Core logic。
- Model-requested tool calls 在执行前被验证。
- Permission policy 评估每个 tool action。
- CLI 可以询问 approval，并把用户 decision 返回 runtime。
- File read/list/write tools 在 workspace rules 内工作。
- Shell commands 默认需要明确 approval。
- Web read/search capability 可用，或带 rationale 明确延后。
- Tool 和 permission events 出现在 trace 中。
- Safety-sensitive behavior 有测试覆盖。

## 18. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Tool System](../architecture/tool-system.zh-CN.md)
- [Permission System](../architecture/permission-system.zh-CN.md)
- [CLI Adapter](../architecture/cli-adapter.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [Execution Trace](../architecture/execution-trace.zh-CN.md)
- [Runtime Composition](../architecture/runtime-composition.zh-CN.md)
- [Architecture Contracts](../architecture/contracts.zh-CN.md)
- [Testing Strategy](../architecture/testing-strategy.zh-CN.md)
- [Development Workflow](../architecture/dev-workflow.zh-CN.md)

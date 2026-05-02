# Testing Strategy

状态：草案
日期：2026-05-02

English version: [testing-strategy.md](./testing-strategy.md)

## 1. 目的

测试是 ArvinClaw 架构的一部分，不是实现之后的清理工作。

ArvinClaw 既是可用的 Agent 产品，也是学习项目。测试应该保护行为、解释模块边界，并让未来重构更安全。

核心规则：

每个模块和每次迭代都应该包含与其风险和职责匹配的测试。

## 2. 为什么这个模块存在

通用 Agent 有风险，因为它把模型输出连接到真实动作。

最高风险区域包括：

- Tool execution
- 文件写入
- Shell commands
- Permission decisions
- Prompt assembly
- Model tool-call parsing
- Configuration 和 secrets
- Session 和 trace persistence
- Memory writes

测试应该让这些边界显式化。

## 3. 测试分层

ArvinClaw 应使用分层测试。

| 层级 | 目的 | 示例 |
| --- | --- | --- |
| Unit tests | 验证隔离行为 | Config 合并、permission classification、redaction |
| Contract tests | 验证模块接口 | Tool result shape、model output normalization |
| Integration tests | 验证跨模块行为 | 使用 fake model 和 fake tools 的 agent loop |
| CLI adapter tests | 验证用户可见工作流 | `arvinclaw chat`、permission prompt flow、slash commands |
| Golden trace tests | 验证 explainable trace shape | 已知 run 的稳定 trace event sequences |
| Safety regression tests | 防止不安全行为回归 | Secret reads、destructive commands、prompt injection cases |

MVP 应从 unit、integration、CLI 和 safety regression tests 开始。Golden trace tests 可以在 trace event shape 稳定后引入。

## 4. 测试替身

测试应避免依赖真实 LLM 调用。

推荐测试替身：

- 带脚本输出的 fake model provider
- Fake tool registry
- Fake tool implementations
- Fake permission adapter responses
- 临时 workspace directory
- In-memory session store
- In-memory trace sink

真实 provider tests 应该是可选的，并与常规测试套件分离。

## 5. 模块期望

每个模块都应有最低测试期望。

| 模块 | 必需测试重点 |
| --- | --- |
| `packages/config` | 优先级、验证、脱敏、secret presence |
| `packages/context` | Source ordering、truncation、redaction、prompt assembly reports |
| `packages/models` | Provider normalization、tool-call parsing、error normalization |
| `packages/core` | Loop state、stop conditions、fake model/tool integration |
| `packages/tools` | Input validation、result shape、workspace boundaries |
| `packages/permissions` | Risk classification、autonomy mode behavior、blocked actions |
| `packages/skills` | Discovery、precedence、malformed skill handling |
| `packages/sessions` | Session records、trace persistence、ordering |
| `apps/cli` | Command parsing、chat startup、approval prompts、trace rendering |

实现计划可以细化具体测试文件，但这些领域不应该被跳过。

## 6. 安全测试

任何会影响文件、命令、secrets、memory 或远程内容的功能，都必须有安全测试。

必需安全用例：

- Secret-like files 被 blocked 或 redacted。
- Shell commands 默认需要确认。
- Unknown tools 被拒绝。
- Invalid tool inputs 在执行前被拒绝。
- Workspace paths 被 normalize。
- Workspace 外路径风险更高。
- Prompt files 不能覆盖 permission policy。
- Skills 不能给自己授予 permissions。
- Trace 和 config output 不暴露 raw secrets。

这些测试一旦加入，就应被视为回归测试。

## 7. Trace 测试

Trace 既是产品 UX，也是学习表面。

Trace tests 应验证：

- Event type
- Event order
- Run ID association
- Tool call ID association
- Permission decision visibility
- Error visibility
- Redaction behavior
- Debug details hidden by default

Trace tests 应避免依赖精确措辞，除非该措辞本身是用户可见契约的一部分。

## 8. CLI 测试

CLI tests 应聚焦 adapter behavior，而不是 Agent intelligence。

必需领域：

- Help 和 version commands
- `chat` startup
- Slash command routing
- Permission prompt rendering
- Approval 和 denial forwarding
- 基于 structured events 的 trace rendering
- 带脱敏的 config display
- Recoverable startup errors

常规测试套件不应通过调用真实 providers 来测试 CLI。

## 9. 文档测试

文档在可行时也可以测试。

有用检查：

- 双语标题数量对齐
- 没有坏的 Markdown links
- 已提交设计文档中没有未完成标记
- Roadmap references 匹配已存在或明确 planned docs
- 可行时，示例 config snippets 能作为 JSON 解析

这些检查应从轻量开始，并随着项目成长逐步自动化。

## 10. 测试数据规则

测试数据应避免真实 secrets、个人数据或生产 credentials。

使用明显的假值：

- `test-api-key`
- `sk-test-redacted`
- `example-model`
- `https://api.example.com/v1`

测试应包含类似 secret 的假值以验证 redaction，但绝不能包含真实 credentials。

## 11. CI 方向

早期 CI 可以很简单：

```text
typecheck
unit tests
integration tests
lint or format check
documentation checks
```

依赖 provider 的测试应该是 opt-in，不阻塞常规 CI。

## 12. 验收标准

Testing strategy 成功标准：

- 每个已实现模块都有清晰测试层级。
- 安全敏感行为有回归测试。
- CLI workflows 不依赖真实模型调用也能测试。
- Config 和 trace redaction 有测试。
- 文档检查保护双语结构和链接。
- 未来 phase plans 包含明确测试工作。

## 13. 相关文档

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Project Structure](./project-structure.zh-CN.md)
- [Runtime Composition](./runtime-composition.zh-CN.md)
- [Architecture Contracts](./contracts.zh-CN.md)
- [Configuration System](./configuration-system.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Execution Trace](./execution-trace.zh-CN.md)

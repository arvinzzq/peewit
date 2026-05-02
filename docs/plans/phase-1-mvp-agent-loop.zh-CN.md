# Phase 1 MVP Agent Loop Plan

状态：草案
日期：2026-05-02

English version: [phase-1-mvp-agent-loop.md](./phase-1-mvp-agent-loop.md)

## Progress

状态：In Progress

已完成：

- Runtime event contracts：`24439e5`
- `ModelProvider` interface 和 fake provider：`7df669d`
- 带 fake HTTP tests 的 OpenAI-compatible provider：`4b86a80`
- Minimal context assembler：`8ef0c54`
- Message-only `AgentRuntime.runTurn`：`eacb8e8`
- CLI fake-provider chat smoke path：`8547d63`

剩余：

- CLI 中的 compact trace rendering
- 用于查看 recent runtime events 的 `/trace` command
- 带 secret redaction 的 `/config` command
- Interactive CLI chat loop
- Real provider configuration wiring
- CLI wiring 可用后更新 Phase 1 acceptance

最新验证：

- `pnpm run check`
- `pnpm run cli --help`
- `pnpm run cli chat --fake "hello"`

下一步建议切片：

- 在加入真实 provider configuration 前，先添加 compact trace formatting 和可支持 `/trace` 的 in-memory trace shape。

## 1. 目的

Phase 1 创建第一个可用的 ArvinClaw agent loop。

目标是一个 CLI chat：可以调用已配置模型、组装 context、运行简单 loop，并产生 explainable trace。Tools 可以保持 minimal 或 fake，直到 Phase 2；但 loop 应为 tool calls 和 permissions 留出清晰路径。

## 2. 用户结果

Phase 1 完成后，用户应该可以：

- 运行 `arvinclaw chat`。
- 发送消息。
- 收到模型回复。
- 看到该 turn 的 explainable trace。
- 检查基础 config 和 runtime metadata。

## 3. 范围

Phase 1 包括：

- `AgentRuntime` 第一版实现。
- `ModelProvider` interface。
- OpenAI-compatible provider。
- Basic context assembler。
- CLI chat adapter。
- Structured trace events。
- Lightweight run IDs。
- Fake provider tests 和 optional real provider smoke path。

Phase 1 不包括：

- Full tool execution。
- Shell command execution。
- Long-term memory。
- Planning system。
- Web UI。
- Multi-agent runtime。

## 4. 计划工作

推荐顺序：

1. 定义 shared runtime event types。
2. 实现用于测试的 fake model provider。
3. 实现 `ModelProvider` interface 和 OpenAI-compatible provider。
4. 实现 minimal context assembler。
5. 实现 trace event model 和 in-memory trace sink。
6. 为 message-only turns 实现 `AgentRuntime.runTurn`。
7. 将 CLI chat 接到 runtime events。
8. 添加基础 run ID 和 session ID handling。
9. 添加 loop、provider normalization、trace 和 CLI rendering 测试。

## 5. 最小 Loop

MVP message-only flow：

```text
User enters message
  -> CLI creates turn input
  -> AgentRuntime creates run ID
  -> ContextAssembler builds model input
  -> ModelProvider generates response
  -> AgentRuntime emits trace events
  -> CLI renders assistant message and trace summary
```

Tool-call flow 可以在类型和测试中表示，但完整执行属于 Phase 2，除非 narrow fake integration test 需要。

## 6. Context Assembly

Phase 1 context assembly 应包括：

- Base system instructions。
- Runtime metadata。
- Effective non-secret configuration metadata。
- Current user message。
- 如果可用，加入 minimal session context。
- 只有在 fake tool-call testing 需要时加入 tool definitions。

它暂时不应包含 long-term memory 或 broad workspace file loading。

## 7. Trace Events

Phase 1 trace 应包括：

- `run_started`
- `context_assembled`
- `model_request_started`
- `model_request_completed`
- `assistant_message_created`
- `run_completed`
- `run_failed`

Trace events 应是 structured 且 redacted。

## 8. CLI Chat

Phase 1 CLI chat 应支持：

- 启动 interactive session。
- 发送 user messages。
- 渲染 assistant responses。
- 显示 compact trace events。
- `/help`
- `/trace`
- `/config`
- `/exit`

Permission prompts 可以延后到 Phase 2，但 runtime event model 应为 `ApprovalRequestEvent` 留出空间。

## 9. Provider Behavior

OpenAI-compatible provider 应该：

- 通过已组装依赖读取 configuration。
- Normalize final assistant text。
- Normalize provider errors。
- 从 trace 中隐藏 raw secrets。
- 在测试中可替换为 fake provider。

Phase 1 可以假设配置模型支持 text responses。如果 tool-call normalization 很小，可以加入；但不应延迟第一个 message loop。

## 10. 测试

Phase 1 必需测试：

- Fake provider 返回 assistant message。
- Context assembler 生成 provider-ready input。
- AgentRuntime 为成功 turn 发出预期 event order。
- Provider 失败时，AgentRuntime 发出 failure trace。
- CLI 从 runtime events 渲染 assistant messages。
- CLI `/trace` 显示近期 trace events。
- CLI `/config` 隐藏 secrets。
- OpenAI-compatible provider 至少归一化一个成功 fake HTTP response。
- 没有测试需要真实 API key。

可选测试：

- 由环境变量开启的 real provider smoke test。
- 使用 fake provider output 的早期 tool-call normalization test。

## 11. 验证命令

Phase 1 应以等价于以下内容的检查结束：

```text
typecheck
unit tests
integration tests
CLI chat smoke test with fake provider
documentation checks
```

Real provider smoke tests 应是 opt-in。

## 12. Commit Plan

建议小粒度 commits：

1. `feat(core): add runtime event contracts`
2. `feat(models): add model provider interface`
3. `feat(models): add openai-compatible provider`
4. `feat(context): add minimal context assembler`
5. `feat(trace): add structured trace events`
6. `feat(core): add message-only agent loop`
7. `feat(cli): wire chat to runtime`
8. `test: cover mvp agent loop`

每个 commit 都应该让它引入的行为保持测试通过。

## 13. 验收标准

Phase 1 完成标准：

- `arvinclaw chat` 可以运行 message-only conversation。
- Agent Core 可以调用 `ModelProvider`。
- Context assembly 由 `packages/context` 拥有。
- CLI 不 assemble prompts。
- 每个 turn 发出 structured trace events。
- Provider errors 可见且可理解。
- Tests 覆盖 runtime、provider normalization、context assembly、trace 和 CLI rendering。
- 实现仍为 Phase 2 的 tools 和 permissions 留好空间。

## 14. 相关文档

- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](../architecture/agent-loop.zh-CN.md)
- [CLI Adapter](../architecture/cli-adapter.zh-CN.md)
- [Model Provider](../architecture/model-provider.zh-CN.md)
- [Prompt Assembly](../architecture/prompt-assembly.zh-CN.md)
- [Context Engine](../architecture/context-engine.zh-CN.md)
- [Execution Trace](../architecture/execution-trace.zh-CN.md)
- [Runtime Composition](../architecture/runtime-composition.zh-CN.md)
- [Architecture Contracts](../architecture/contracts.zh-CN.md)
- [Testing Strategy](../architecture/testing-strategy.zh-CN.md)

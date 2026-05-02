# Phase 1 MVP Test Guide

状态：Active
日期：2026-05-03

English version: [phase-1-mvp-test-guide.md](./phase-1-mvp-test-guide.md)

## 1. 目的

这份指南说明如何从用户视角测试 Phase 1 ArvinClaw MVP。

Phase 1 验证第一个可用 Agent Loop：

```text
CLI input
  -> AgentRuntime
  -> ContextAssembler
  -> ModelProvider
  -> Runtime events
  -> CLI output and trace
```

它不验证 tools、persistent sessions、long-term memory、Web UI、channels 或 background automation。

## 2. 本地验证

运行完整项目检查：

```bash
pnpm run check
```

预期结果：

- TypeScript build 通过。
- 所有测试通过。
- Documentation checks 通过。

## 3. CLI Help

运行：

```bash
pnpm run cli --help
```

预期结果：

- CLI 打印可用命令。
- 列出 `chat`、`chat --fake` 和 `chat --fake-interactive`。

## 4. 单轮 Fake Chat

运行：

```bash
pnpm run cli chat --fake "hello"
```

预期结果：

- CLI 打印 fake assistant response。
- CLI 打印 compact trace events。
- Trace 包含 `run_started`、`context_assembled`、`model_request_started`、`model_request_completed`、`assistant_message_created` 和 `run_completed`。

## 5. 带 Trace 的单轮 Fake Chat

运行：

```bash
pnpm run cli chat --fake "hello" /trace
```

预期结果：

- CLI 打印 assistant response。
- CLI 打印当前 turn trace。
- CLI 通过 `/trace` 打印 recent trace。

## 6. 脱敏 Config

运行：

```bash
ARVINCLAW_API_KEY=secret-api-key pnpm run cli chat --fake "hello" /config
```

预期结果：

- CLI 打印 `API key: configured`。
- CLI 不打印 `secret-api-key`。

## 7. Interactive Fake Chat

运行：

```bash
printf 'Hello fake\n/trace\n/config\n/exit\n' | pnpm run cli chat --fake-interactive
```

预期结果：

- CLI 启动一个 interactive fake-provider session。
- Assistant 回复用户消息。
- `/trace` 显示 recent trace events。
- `/config` 显示 redacted configuration。
- `/exit` 结束 session。

## 8. Configured Provider Chat

运行：

```bash
ARVINCLAW_API_KEY=your_api_key pnpm run cli chat
```

预期结果：

- CLI 启动一个 interactive chat session。
- 用户消息通过 configured OpenAI-compatible provider 发送。
- Assistant responses 在终端中渲染。

如果缺少 `ARVINCLAW_API_KEY`：

```bash
pnpm run cli chat
```

预期结果：

- CLI 用清晰的 missing API key message 退出。
- CLI 建议使用 `chat --fake-interactive` 进行本地学习。

## 9. 当前 OpenClaw 对齐情况

Phase 1 在这些方面对齐 OpenClaw：

- 使用 shared runtime boundary，而不是让 CLI 拥有 Agent 行为。
- 使用 provider-neutral model layer。
- 使用 structured runtime events 保证 traceability。
- 渲染 redacted configuration。
- 采用 CLI-first learning workflow。

Phase 1 在这些方面仍不同于 OpenClaw：

- 没有 persistent JSONL session storage。
- 没有针对 `AGENTS.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 或 `TOOLS.md` 的 workspace startup loading。
- 除当前 turn 外，没有 short-term conversation memory。
- 没有 long-term memory files 或 daily memory notes。
- 没有 tools 或 permission policy。
- 没有 skills、plugins、gateway、channels、heartbeat 或 multi-agent runtime。

## 10. 下一阶段

下一阶段实现重点应是 session storage 和 short-term memory。

这项工作应添加：

- Stable session IDs。
- JSONL session records。
- Context assembly 中的 recent conversation history。
- Trace persistence hooks。
- 通往 OpenClaw-style workspace 和 memory files 的清晰路径。

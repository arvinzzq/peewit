# Phase 1 MVP Agent Loop Plan

Status: Complete
Date: 2026-05-02

Simplified Chinese version: [phase-1-mvp-agent-loop.zh-CN.md](./phase-1-mvp-agent-loop.zh-CN.md)

## Progress

Status: Complete

Completed:

- Runtime event contracts: `24439e5`
- `ModelProvider` interface and fake provider: `7df669d`
- OpenAI-compatible provider with fake HTTP tests: `4b86a80`
- Minimal context assembler: `8ef0c54`
- Message-only `AgentRuntime.runTurn`: `eacb8e8`
- CLI fake-provider chat smoke path: `8547d63`
- In-memory runtime trace store and compact CLI trace rendering: `39c7868`, `2751a9c`
- Same-run `/trace` command shape: `4d2ebe2`
- Same-run `/config` command with redacted config: `ef005af`
- Interactive CLI chat loop with fake provider: `518a936`
- Interactive CLI configured provider wiring: `b1bfe3a`
- Phase 1 acceptance and user test guide: in progress

Remaining:

- None for Phase 1 MVP scope

Latest verification:

- `pnpm run check`
- `pnpm run cli --help`
- `pnpm run cli chat --fake "hello"`
- `pnpm run cli chat --fake "hello" /trace`
- `PEEWIT_API_KEY=secret pnpm run cli chat --fake "hello" /config`
- `printf 'Hello\n/trace\n/config\n/exit\n' | pnpm run cli chat --fake-interactive`
- `pnpm run cli chat`

Next recommended slice:

- Start Phase 5-style session storage and short-term memory work as the next OpenClaw-aligned increment.

## 1. Purpose

Phase 1 creates the first usable Peewit agent loop.

The goal is a CLI chat that can call a configured model, assemble context, run a simple loop, and produce an explainable trace. Tools can remain minimal or fake until Phase 2, but the loop should leave a clear path for tool calls and permissions.

## 2. User Result

After Phase 1, the user should be able to:

- Run `peewit chat`.
- Send a message.
- Receive a model response.
- See an explainable trace for the turn.
- Inspect basic config and runtime metadata.

## 3. Scope

Phase 1 includes:

- `AgentRuntime` first implementation.
- `ModelProvider` interface.
- OpenAI-compatible provider.
- Basic context assembler.
- CLI chat adapter.
- Structured trace events.
- Lightweight run IDs.
- Fake provider tests and optional real provider smoke path.

Phase 1 does not include:

- Full tool execution.
- Shell command execution.
- Long-term memory.
- Planning system.
- Web UI.
- Multi-agent runtime.

## 4. Planned Work

Recommended order:

1. Define shared runtime event types.
2. Implement fake model provider for tests.
3. Implement `ModelProvider` interface and OpenAI-compatible provider.
4. Implement minimal context assembler.
5. Implement trace event model and in-memory trace sink.
6. Implement `AgentRuntime.runTurn` for message-only turns.
7. Wire CLI chat to runtime events.
8. Add basic run ID and session ID handling.
9. Add tests for loop, provider normalization, trace, and CLI rendering.

## 5. Minimal Loop

MVP message-only flow:

```text
User enters message
  -> CLI creates turn input
  -> AgentRuntime creates run ID
  -> ContextAssembler builds model input
  -> ModelProvider generates response
  -> AgentRuntime emits trace events
  -> CLI renders assistant message and trace summary
```

Tool-call flow can be represented in types and tests, but full execution belongs to Phase 2 unless needed for a narrow fake integration test.

## 6. Context Assembly

Phase 1 context assembly should include:

- Base system instructions.
- Runtime metadata.
- Effective non-secret configuration metadata.
- Current user message.
- Minimal session context if available.
- Tool definitions only if fake tool-call testing requires them.

It should not include long-term memory or broad workspace file loading yet.

## 7. Trace Events

Phase 1 trace should include:

- `run_started`
- `context_assembled`
- `model_request_started`
- `model_request_completed`
- `assistant_message_created`
- `run_completed`
- `run_failed`

Trace events should be structured and redacted.

## 8. CLI Chat

Phase 1 CLI chat should support:

- Starting an interactive session.
- Sending user messages.
- Rendering assistant responses.
- Showing compact trace events.
- `/help`
- `/trace`
- `/config`
- `/exit`

Permission prompts can be deferred until Phase 2, but the runtime event model should leave room for `ApprovalRequestEvent`.

## 9. Provider Behavior

The OpenAI-compatible provider should:

- Read configuration through composed dependencies.
- Normalize final assistant text.
- Normalize provider errors.
- Hide raw secrets from trace.
- Be replaceable with a fake provider in tests.

Phase 1 can assume the configured model supports text responses. Tool-call normalization may be added if small, but should not delay the first message loop.

## 10. Tests

Required Phase 1 tests:

- Fake provider returns assistant message.
- Context assembler produces provider-ready input.
- AgentRuntime emits expected event order for a successful turn.
- AgentRuntime emits failure trace when provider fails.
- CLI renders assistant messages from runtime events.
- CLI `/trace` shows recent trace events.
- CLI `/config` hides secrets.
- OpenAI-compatible provider normalizes at least one successful fake HTTP response.
- No test requires a real API key.

Optional tests:

- Real provider smoke test gated by environment variable.
- Early tool-call normalization test using fake provider output.

## 11. Verification Commands

Phase 1 should end with equivalents of:

```text
typecheck
unit tests
integration tests
CLI chat smoke test with fake provider
documentation checks
```

Real provider smoke tests should be opt-in.

## 12. Commit Plan

Suggested fine-grained commits:

1. `feat(core): add runtime event contracts`
2. `feat(models): add model provider interface`
3. `feat(models): add openai-compatible provider`
4. `feat(context): add minimal context assembler`
5. `feat(trace): add structured trace events`
6. `feat(core): add message-only agent loop`
7. `feat(cli): wire chat to runtime`
8. `test: cover mvp agent loop`

Each commit should keep tests passing for the behavior it introduces.

## 13. Acceptance Criteria

Phase 1 is complete when:

- `peewit chat` can run a message-only conversation.
- Agent Core can call a `ModelProvider`.
- Context assembly is owned by `packages/context`.
- CLI does not assemble prompts.
- Each turn emits structured trace events.
- Provider errors are visible and understandable.
- Tests cover runtime, provider normalization, context assembly, trace, and CLI rendering.
- The implementation still leaves tools and permissions ready for Phase 2.

## 14. User Test Guide

Phase 1 user-facing verification lives in [Phase 1 MVP Test Guide](./phase-1-mvp-test-guide.md).

That guide records:

- Local verification commands.
- CLI smoke paths.
- Redacted config behavior.
- Configured provider behavior.
- Current OpenClaw alignment and gaps.
- The next OpenClaw-aligned implementation focus.

## 15. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Agent Loop](../architecture/agent-loop.md)
- [CLI Adapter](../architecture/cli-adapter.md)
- [Model Provider](../architecture/model-provider.md)
- [Prompt Assembly](../architecture/prompt-assembly.md)
- [Context Engine](../architecture/context-engine.md)
- [Execution Trace](../architecture/execution-trace.md)
- [Runtime Composition](../architecture/runtime-composition.md)
- [Architecture Contracts](../architecture/contracts.md)
- [Testing Strategy](../architecture/testing-strategy.md)
- [Phase 1 MVP Test Guide](./phase-1-mvp-test-guide.md)

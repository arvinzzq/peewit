# Phase 1 MVP Test Guide

Status: Active
Date: 2026-05-03

Simplified Chinese version: [phase-1-mvp-test-guide.zh-CN.md](./phase-1-mvp-test-guide.zh-CN.md)

## 1. Purpose

This guide explains how to test the Phase 1 ArvinClaw MVP from a user's point of view.

Phase 1 proves the first usable agent loop:

```text
CLI input
  -> AgentRuntime
  -> ContextAssembler
  -> ModelProvider
  -> Runtime events
  -> CLI output and trace
```

It does not prove tools, persistent sessions, long-term memory, Web UI, channels, or background automation.

## 2. Local Verification

Run the full project check:

```bash
pnpm run check
```

This runs type checking, unit tests, and documentation checks.

Expected result:

- TypeScript build passes.
- All tests pass.
- Documentation checks pass.

## 3. CLI Help

Run:

```bash
pnpm run cli --help
```

Expected result:

- The CLI prints available commands.
- `chat`, `chat --fake`, and `chat --fake-interactive` are listed.

## 4. One-Turn Fake Chat

Run:

```bash
pnpm run cli chat --fake "hello"
```

Expected result:

- The CLI prints a fake assistant response.
- The CLI prints compact trace events.
- The trace includes `run_started`, `context_assembled`, `model_request_started`, `model_request_completed`, `assistant_message_created`, and `run_completed`.

## 5. One-Turn Fake Chat with Trace

Run:

```bash
pnpm run cli chat --fake "hello" /trace
```

Expected result:

- The CLI prints the assistant response.
- The CLI prints the current turn trace.
- The CLI prints the recent trace through `/trace`.

## 6. Redacted Config

Run:

```bash
ARVINCLAW_API_KEY=secret-api-key pnpm run cli chat --fake "hello" /config
```

Expected result:

- The CLI prints `API key: configured`.
- The CLI does not print `secret-api-key`.

## 7. Interactive Fake Chat

Run:

```bash
printf 'Hello fake\n/trace\n/config\n/exit\n' | pnpm run cli chat --fake-interactive
```

Expected result:

- The CLI starts an interactive fake-provider session.
- The assistant responds to the user message.
- `/trace` shows recent trace events.
- `/config` shows redacted configuration.
- `/exit` ends the session.

## 8. Configured Provider Chat

Run:

```bash
ARVINCLAW_API_KEY=your_api_key pnpm run cli chat
```

Expected result:

- The CLI starts an interactive chat session.
- User messages are sent through the configured OpenAI-compatible provider.
- Assistant responses are rendered in the terminal.

If `ARVINCLAW_API_KEY` is missing:

```bash
pnpm run cli chat
```

Expected result:

- The CLI exits with a clear missing API key message.
- The CLI suggests `chat --fake-interactive` for local learning.

## 9. Current OpenClaw Alignment

Phase 1 aligns with OpenClaw in these areas:

- A shared runtime boundary instead of CLI-owned agent behavior.
- A provider-neutral model layer.
- Structured runtime events for traceability.
- Redacted configuration rendering.
- A CLI-first learning workflow.

Phase 1 still differs from OpenClaw in these areas:

- No persistent JSONL session storage.
- No workspace startup loading for `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, or `TOOLS.md`.
- No short-term conversation memory beyond the current turn.
- No long-term memory files or daily memory notes.
- No tools or permission policy.
- No skills, plugins, gateway, channels, heartbeat, or multi-agent runtime.

## 10. Next Phase

The next implementation focus should be session storage and short-term memory.

That work should add:

- Stable session IDs.
- JSONL session records.
- Recent conversation history in context assembly.
- Trace persistence hooks.
- A clear path toward OpenClaw-style workspace and memory files.

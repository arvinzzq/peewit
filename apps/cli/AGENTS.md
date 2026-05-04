# CLI Agent Guide

## Responsibility

Keep this package focused on terminal adaptation. It may compose runtime, config, workspace-aware and memory-policy-aware context assembly including daily memory, built-in file tools, approval prompts through the runtime approval resolver, and durable session/message/trace dependencies for CLI commands, but agent behavior belongs in `packages/core`, prompt/context work belongs in `packages/context`, session persistence belongs in `packages/sessions`, provider normalization belongs in `packages/models`, and tool implementation belongs in `packages/tools`.

## When Files Change

Update `README.md`, `README.zh-CN.md`, `AGENTS.md`, and `AGENTS.zh-CN.md` when files or responsibilities change. Update the source header in `src/index.ts` when inputs, outputs, or system position change.

## Testing

CLI-visible behavior, session listing/resume, workspace prompt and read-only long-term/daily memory handoff, interactive input loops, built-in file and shell tool registration, approval prompts, durable message and trace handoff, short-term memory handoff, slash commands, trace rendering, config redaction and memory policy display, and missing API key handling need tests in `src/index.test.ts`. Use injected fake HTTP for configured-provider tests. Do not require a real model provider or API key in CLI unit tests.

## Boundaries

Do not assemble prompts, implement tools, decide permissions, or embed vendor-specific provider logic here.

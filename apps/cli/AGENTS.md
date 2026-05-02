# CLI Agent Guide

## Responsibility

Keep this package focused on terminal adaptation. It may compose runtime and config dependencies for CLI commands, but agent behavior belongs in `packages/core`, prompt/context work belongs in `packages/context`, and provider normalization belongs in `packages/models`.

## When Files Change

Update `README.md`, `README.zh-CN.md`, `AGENTS.md`, and `AGENTS.zh-CN.md` when files or responsibilities change. Update the source header in `src/index.ts` when inputs, outputs, or system position change.

## Testing

CLI-visible behavior, slash commands, trace rendering, and config redaction need tests in `src/index.test.ts`. Fake-provider smoke paths are allowed. Do not require a real model provider or API key in CLI unit tests.

## Boundaries

Do not assemble prompts, execute tools, decide permissions, or embed vendor-specific provider logic here.

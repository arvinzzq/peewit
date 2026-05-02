# CLI Agent Guide

## Responsibility

Keep this package focused on terminal adaptation. Agent behavior belongs in `packages/core`, prompt/context work belongs in `packages/context`, and provider calls belong in `packages/models`.

## When Files Change

Update `README.md`, `README.zh-CN.md`, `AGENTS.md`, and `AGENTS.zh-CN.md` when files or responsibilities change. Update the source header in `src/index.ts` when inputs, outputs, or system position change.

## Testing

CLI-visible behavior needs tests in `src/index.test.ts`. Do not require a real model provider or API key in CLI unit tests.

## Boundaries

Do not assemble prompts, instantiate long-lived agent internals, execute tools, or decide permissions here.

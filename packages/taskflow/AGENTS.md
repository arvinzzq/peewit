# TaskFlow Agent Guide

## Responsibility

Keep persistent cross-session task graph state here. Store task records with lifecycle status, progress summaries, terminal summaries, and parent/child relationships. Runtime code should depend on the `TaskFlowStore` interface instead of knowing storage details.

## When Files Change

Update README and AGENTS files when task graph responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

TaskFlow logic needs tests for create, update, get, list, filter by status, filter by parentId, limit, and undefined behavior for missing ids.

## Boundaries

Do not assemble prompts, call model providers, execute tools, render CLI output, or manage session conversation records in this package. Session conversation storage belongs in `packages/sessions`.

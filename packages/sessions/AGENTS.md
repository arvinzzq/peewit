# Sessions Agent Guide

## Responsibility

Keep short-term conversation records, future durable session storage, and trace persistence here. Runtime code should depend on a session interface instead of knowing storage details.

## When Files Change

Update README and AGENTS files when persistence responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Session logic needs tests for create, append, load, ordering, defensive copies, write safety, and future replay behavior.

## Boundaries

Do not assemble prompts, call providers, execute tools, or render CLI output in this package.

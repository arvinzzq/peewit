# Sessions Agent Guide

## Responsibility

Keep short-term conversation records, durable JSONL session storage, and future trace persistence here. Runtime code should depend on a session interface instead of knowing storage details.

## When Files Change

Update README and AGENTS files when persistence responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Session logic needs tests for create, append, load, session listing, ordering, defensive copies, write safety, unsafe session IDs, and replay behavior.

## Boundaries

Do not assemble prompts, call providers, execute tools, or render CLI output in this package.

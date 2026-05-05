# Models Agent Guide

## Responsibility

Keep provider-specific request and response handling here. Public outputs should be normalized into ArvinClaw model types before reaching core.

## When Files Change

Update README and AGENTS files when provider responsibilities or file inventory change. Update `src/index.ts` header when provider inputs, outputs, or position change.

## Testing

Provider behavior must be testable without network access. Inject fake `fetch` implementations and assert normalized outputs and secret-safe errors.

## Boundaries

Do not put runtime orchestration, prompt assembly, tool execution, or CLI rendering in this package.

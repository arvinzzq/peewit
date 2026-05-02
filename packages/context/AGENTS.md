# Context Agent Guide

## Responsibility

Keep model-facing context selection and assembly here. This package should produce provider-neutral model input and reports that explain what was included or omitted.

## When Files Change

Update README and AGENTS files when context sources, ordering, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Context ordering, included sections, omitted sections, and future redaction behavior need tests. Do not rely on CLI rendering or provider-specific formatting.

## Boundaries

Do not call model providers, execute tools, read secrets, or render terminal output here.

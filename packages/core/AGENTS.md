# Core Agent Guide

## Responsibility

Keep this package focused on runtime coordination and shared runtime contracts. It may orchestrate injected dependencies, but it should not read environment variables, render CLI output, or call vendor APIs directly.

## When Files Change

Update local README and AGENTS files when runtime responsibilities or file inventory change. Update `src/index.ts` header when runtime dependencies, exports, or system position change.

## Testing

Runtime event order, failure events, and dependency injection behavior need unit tests. Use fake providers and fake assemblers; no real API keys.

## Boundaries

Do not put prompt construction, CLI rendering, model SDK code, tool implementation, or permission UX in this package.

# Core Agent Guide

## Responsibility

Keep this package focused on runtime coordination, short-term context handoff, model-requested tool-call events, permission evaluation events, approval resolution events, executable tool orchestration, shared runtime contracts, trace storage interfaces, and the `SubagentFactory` / `createSpawnSubagentTool` for in-process sub-agent spawning. It may orchestrate injected dependencies, but it should not read environment variables, render CLI output, collect approval UI, or call vendor APIs directly.

## When Files Change

Update local README and AGENTS files when runtime responsibilities or file inventory change. Update `src/index.ts` header when runtime dependencies, exports, or system position change.

## Testing

Runtime event order, trace storage, short-term context handoff, tool-call request events, permission evaluation events, approval resolution events, tool lifecycle events, failure events, and dependency injection behavior need unit tests. Use fake providers, fake assemblers, injected fake permission policies, injected fake approval resolvers, and safe fake or read-only tools; no real API keys.

## Boundaries

Do not put prompt construction, CLI rendering, model SDK code, tool implementation details, or permission UX in this package.

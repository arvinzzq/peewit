# Web App Agent Guide

## Responsibility

This app is a UI adapter. Keep agent logic (context assembly, tool execution, permission policy) in packages. The web app only routes HTTP requests and renders events.

## When Files Change

Update README and AGENTS files when the API surface or file inventory changes. Update `src/server.ts` header when server inputs, outputs, or position change.

## Boundaries

- Do not assemble prompts or context here.
- Do not define or execute tools here.
- Do not apply permission policy here.
- Session store choice (InMemorySessionStore in Phase 6) can be upgraded in Phase 7+.

## Development

Run `pnpm --filter @arvinclaw/web run dev` to start both Hono and Vite. Requires ARVINCLAW_API_KEY.

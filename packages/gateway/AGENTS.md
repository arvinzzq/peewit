# Gateway Agent Guide

## Responsibility

Keep this package focused on session registry operations: register, unregister, touch, get, list, and listByAdapter. The gateway tracks which sessions are alive and which adapter owns them. It does not make routing decisions, run agent logic, or hold conversation state.

## When Files Change

Update local README and AGENTS files when registry responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

All registry operations need unit tests. Use fixed timestamps and capability constants from `@peewit/adapters`. No real API keys or file system access needed — the gateway is a pure in-memory registry.

## Boundaries

Do not put agent logic, tool execution, permission decisions, session message history, or trace storage in this package. Those belong in `packages/core`, `packages/tools`, `packages/permissions`, and `packages/sessions` respectively.

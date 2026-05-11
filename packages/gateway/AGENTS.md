# Gateway Agent Guide

## Responsibility

Two layers:

1. `SessionGateway` — session registry: register, unregister, touch, get, list, listByAdapter.
2. `GatewayCore` — Phase 11 expansion: admit runs through `@vole/lanes`, support cancel, expose status. Extends `SessionGateway`.

The gateway is the single entry point for every agent run from Phase 11 onward. Adapters submit `RunRequest`s; the gateway threads them through lane admission and dispatches the caller-provided run function.

## When Files Change

Update local README and AGENTS files when registry or admission responsibilities change, or when the file inventory changes. Update `src/index.ts` header when inputs, outputs, or system position change. The header markers (INPUT / OUTPUT / POS) are enforced by `scripts/check-docs.ts`.

## Testing

All registry operations and admission paths need unit tests. Use fixed timestamps for the registry; use `deferred()` helpers to control timing in lane-admission and cancellation tests. No real API keys or file system access needed — the gateway is pure in-process orchestration.

## Boundaries

Do not put agent logic, tool execution, permission decisions, session message history, or trace storage in this package. Those belong in `packages/core`, `packages/tools`, `packages/permissions`, and `packages/sessions` respectively.

Do not import `@vole/core` here. The caller supplies a `run(signal) => AsyncIterable<events>` callback; the gateway invokes it inside a lane chain. This inversion keeps the dependency graph acyclic and lets the gateway be tested without spinning up a runtime.

Subscribe (joining an active run's event stream from a second consumer) is deferred to Phase 12 when channels and Web UIs need it. Phase 11 ships only `submit / cancel / status`.

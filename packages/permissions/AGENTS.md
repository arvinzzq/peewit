# Permissions Agent Guide

## Responsibility

Owns two concerns: (1) risk classification + approval policy (allow / ask / deny) and (2) the `SandboxBackend` execution-boundary abstraction introduced in Phase 16. Adapters can ask the user, but this package decides whether approval is required and which sandbox backend a tool runs through.

## When Files Change

Update README and AGENTS files when permission responsibilities, sandbox backend semantics, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change. Bilingual heading parity must hold for docs:check.

## Testing

Permission logic needs tests for risk levels, autonomy modes, allow/ask/deny decisions, blocked actions, and trace-safe explanations.

Sandbox tests must cover, for every backend: backend name, `available()` truthiness, benign command execution (stdout + exit code), workspace-escape rejection, cwd containment, timeout surfaced as `{ completed: false, reason: "timeout" }`, and non-zero exit codes propagating. Future Docker / Worker backends in Phase 16b should reuse the same shape via a shared conformance suite.

## Boundaries

Do not execute tools through anything other than a `SandboxBackend`, do not render prompts, do not collect user approval UI in this package.

Sandbox backends own process / container / worker spawn — `@vole/tools` calls `sandbox.execute(...)` rather than spawning processes directly once the Phase 16 wiring lands. Tools never reach past the backend interface.

Backend implementations that need external runtimes (Docker daemon, worker thread, future remote dispatch) own their own availability checks via `available()`; callers must always degrade gracefully rather than throwing on missing infrastructure.

# Lanes Agent Guide

## Responsibility

Keep run admission and serialization here. `Lane` is a FIFO queue with a concurrency cap; `LaneRegistry` composes three tiers (global, sub-agent, per-session) into the chain that every gateway-accepted run must pass through.

## When Files Change

Update README and AGENTS files when admission responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Lane logic needs tests for FIFO order under load, concurrency cap enforcement, slot release on both success and rejection paths, session-lane lifecycle (lazy creation + idle-only reclaim), and lane-chain composition via `runThroughLanes`.

## Boundaries

Do not import `AgentRuntime`, sessions, models, or any other workspace package here. Lanes is the lowest layer of the run admission stack; it must remain dependency-free so it can be unit-tested in isolation and consumed by `@vole/gateway` without cycles.

Do not perform any I/O. No file locks, no network, no logging. Cross-process serialization belongs to the session storage layer's file lock; lanes only order work within one Node process.

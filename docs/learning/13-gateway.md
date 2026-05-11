# Module 12: @vole/gateway

Status: Complete (Phase 10 baseline) · Phase 11 Step 3 expansion in progress
Date: 2026-05-07 (last full review); 2026-05-11 (forward-looking note added)

Simplified Chinese version: `13-gateway.zh-CN.md`

Related source: `packages/gateway/src/index.ts`

> **Forward-looking note**: This document describes the 49-line Phase 10 `SessionGateway` registry.
> Phase 11 Step 3 expands the package into a `GatewayCore` with `submit / subscribe / cancel /
> status`, lane-based admission via `@vole/lanes` (see [16-lanes.md](./16-lanes.md)), and a
> cross-process file lock around session JSONL. When Step 3 lands, this document will be rewritten
> end-to-end. Until then: read this for the historical baseline; read
> [Phase 11 plan](../plans/phase-11-gateway-and-lanes.md), [gateway.md](../architecture/gateway.md),
> and [lanes.md](../architecture/lanes.md) for what is coming.

## 0. How to Use This Document

This document is part of Stage 4 (Extension Systems) in the [learning guide](./guide.md).
Read it after [12-adapters.md](./12-adapters.md) — `GatewaySession` carries `AdapterCapabilities`
from that package.

**Before reading**: Read `packages/gateway/src/index.ts` in full (49 lines). It is one class
and one interface. Then grep for `SessionGateway` in `apps/cli` and `apps/web` to see how it
is used.

**Focus questions**:
- `SessionGateway` is in-memory only. What happens to all registered sessions when the process
  restarts?
- `touch()` silently ignores unknown session IDs. Why is this the right behaviour?
- Both CLI and Web create their own `SessionGateway` singleton. Can they ever see each other's
  sessions? Should they?

**Checkpoint**: You understand this module when you can explain what problem `SessionGateway`
solves that `JsonlSessionStore` does not, and why the gateway is in-memory while sessions are
on disk.

## 1. What This Module Does

**Plain language**: Think of the gateway as the front desk of a busy office building. The front
desk doesn't store permanent employee records (that's HR — the session store). It keeps a live
whiteboard of who is currently in the building, which floor they arrived from, and when they
were last seen walking around. When someone leaves, their name is erased. The whiteboard only
reflects right now.

**Technical summary**: `@vole/gateway` provides `SessionGateway`, an in-memory registry of
currently active sessions across adapter surfaces. Each entry is a `GatewaySession` record:
session ID, adapter name, capabilities, registration time, and last activity timestamp. The
registry supports register, unregister, touch (update activity), get, list, and listByAdapter.
It has no persistence — data lives only for the process lifetime.

## 2. Why It Exists

`JsonlSessionStore` persists conversation history across process restarts. It answers "what was
said in session X?" The gateway answers a different question: "which sessions are currently
active right now, and from which surface?"

Without a gateway, there is no way to:
- List all open CLI sessions in the current process
- Expose an API endpoint showing active web sessions
- Enforce a concurrent-run guard ("session X is already running, reject this new turn")
- Route a message to the right surface when multiple adapters coexist

The gateway is the live presence layer; the session store is the history layer. They are
complementary and intentionally separate.

## 3. Public Interface

```ts
interface GatewaySession {
  id: string;
  adapterName: string;           // "cli", "web", etc.
  capabilities: AdapterCapabilities;
  registeredAt: string;          // ISO 8601
  lastActivityAt: string;        // ISO 8601, updated by touch()
}

class SessionGateway {
  register(session: GatewaySession): void
  unregister(sessionId: string): void
  touch(sessionId: string): void         // updates lastActivityAt; no-op for unknown id
  get(sessionId: string): GatewaySession | undefined
  list(): GatewaySession[]
  listByAdapter(adapterName: string): GatewaySession[]
}
```

## 4. Implementation Walkthrough

### In-memory Map, no persistence

```ts
class SessionGateway {
  readonly #sessions = new Map<string, GatewaySession>();
  // ...
}
```

A private `Map<string, GatewaySession>` is all there is. Register adds an entry, unregister
deletes it, touch replaces the value with an updated `lastActivityAt`. Process restart wipes
everything — by design, because "currently active" only makes sense for the current process.

### touch: immutable update

```ts
touch(sessionId: string): void {
  const s = this.#sessions.get(sessionId);
  if (s !== undefined) {
    this.#sessions.set(sessionId, { ...s, lastActivityAt: new Date().toISOString() });
  }
}
```

`GatewaySession` records are replaced, not mutated in place. The spread creates a new object
with the updated timestamp. This keeps the records structurally consistent and avoids aliasing
bugs if a caller holds a reference to a previous record.

The `if (s !== undefined)` guard makes `touch` a silent no-op for unknown IDs. The alternative
— throwing — would require every caller to guard against stale session IDs, which is not worth
the defensive overhead in an in-process registry.

### One gateway per adapter, not one global

Both CLI and Web create module-level singletons:

```ts
// apps/cli/src/index.ts
const cliGateway = new SessionGateway();

// apps/web/src/server.ts
const webGateway = new SessionGateway();
```

They are separate instances in separate processes (or even in the same process but isolated by
module). CLI sessions and Web sessions never appear in each other's registry. This is correct:
the gateway tracks sessions for one adapter's coordination needs, not cross-process presence.
A future multi-adapter gateway could aggregate them, but that is not a current requirement.

### How CLI uses it

The CLI's `ChatSession` class (the Ink component managing a single interactive chat) registers
itself on construction and unregisters on cleanup:

```ts
// Registration on session start
const gatewaySession: GatewaySession = {
  id: this.#sessionId,
  adapterName: "cli",
  capabilities: CLI_CAPABILITIES,
  registeredAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString()
};
cliGateway.register(gatewaySession);

// Cleanup when component unmounts
this.#gateway?.unregister(this.#sessionId);
```

### How Web uses it

The web server registers sessions at turn start and exposes the live list via a REST endpoint:

```ts
// Registration before turn runs
// GET /api/gateway/sessions — returns live session list
app.get("/api/gateway/sessions", (c) => {
  return c.json({ sessions: webGateway.list() });
});
```

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Session registry for multi-entry coordination | `SessionGateway` | Same in-memory map approach |
| Per-adapter session isolation | Separate gateway singletons per adapter | Same pattern |
| Activity timestamp for presence detection | `GatewaySession.lastActivityAt` + `touch()` | Same concept |
| Gateway sessions API endpoint | `GET /api/gateway/sessions` | Same pattern |

## 6. Key Design Decisions

**In-memory only — intentionally not persistent**

The gateway tracks presence, not history. A session that ended is no longer "present" and
does not belong in the registry. Persisting the registry would add the complexity of stale
entry cleanup (what if the process crashed and never unregistered?) without adding any value.
The session store handles history; the gateway handles liveness.

**Per-adapter singletons, not one global gateway**

A single global gateway would require all adapters to share a registry, which means they would
need to coordinate on session ID namespacing and adapter tagging. Per-adapter singletons are
simpler: each adapter registers only its own sessions and queries only its own registry. The
`listByAdapter` method exists for the case where one adapter hosts multiple named sub-surfaces.

**`touch` is a no-op for unknown IDs**

During normal operation, `touch` is called during an active session's turn. A race condition
where the session is unregistered just before `touch` is called should not throw — the turn
is already ending anyway. Silent no-op is the correct response to a stale reference.

**`GatewaySession` carries capabilities, not just an ID**

Including `AdapterCapabilities` in the session record allows any code that receives a
`GatewaySession` to make capability-aware decisions (e.g., "can this session stream output?")
without having to look up the adapter separately. The capabilities are set at registration
time and treated as immutable for the session's lifetime.

## 7. Testing Approach

Tests are in `packages/gateway/src/index.test.ts`. All tests are synchronous in-memory
operations — no filesystem, no async:

- `register` / `get`: registration makes session retrievable
- `unregister`: removes the session; `get` returns `undefined`
- `get` for unknown ID: returns `undefined`
- `list`: returns all registered sessions; empty when none
- `listByAdapter`: filters correctly; returns empty for non-matching adapter
- `touch`: updates `lastActivityAt`; no-op for unknown ID (does not throw)

## 8. Insights

**The gateway and the session store answer different questions.** `JsonlSessionStore.listMessages`
answers "what did the agent say in session X?" `SessionGateway.list()` answers "which sessions
exist right now in this process?" These are orthogonal. A session can exist in the store but
not in the gateway (it ended). A session can exist in the gateway but have no stored messages
yet (it just started).

**The gateway is the right place for concurrent-run guards.** If two requests arrive for the
same session ID simultaneously, the gateway can detect this: `get(sessionId)` returns a record
whose `lastActivityAt` is suspiciously recent. A mutex or "running" flag on the gateway record
would prevent concurrent agent runs. Currently Vole uses `SessionMutex` from `@vole/sessions`
for this, but the gateway is the natural coordination point for multi-adapter presence.

**49 lines — the smallest package in the monorepo.** The gateway does exactly one thing: track
active sessions in memory. Its simplicity is a feature. Adding persistence, eviction policies,
or TTL-based cleanup would all belong in an extended gateway layer, not in this package.

## 9. Review Questions

1. What happens to `SessionGateway` contents when the process restarts?
   > All entries are lost. The gateway is a `Map` in memory — there is no persistence. This
   > is intentional: the gateway tracks liveness (who is active right now), not history (what
   > was said). Sessions that ended before the restart are not "active" and should not appear.

2. CLI and Web both create `SessionGateway` singletons. Can they see each other's sessions?
   > No. They are separate instances. CLI sessions are registered in `cliGateway`; Web sessions
   > in `webGateway`. They never share state. This is correct: each adapter coordinates its
   > own sessions independently.

3. `touch("unknown_id")` — what happens?
   > Nothing. The `if (s !== undefined)` guard makes it a silent no-op. The unknown ID is
   > simply ignored; no exception is thrown. This handles the race condition where a session
   > is unregistered just before `touch` is called during a winding-down turn.

4. What does `GatewaySession.capabilities` contain, and why is it stored on the gateway record?
   > It contains the `AdapterCapabilities` of the adapter that owns the session: `streaming`,
   > `approvalPrompts`, `background`. Storing it on the record means any consumer of a
   > `GatewaySession` can make capability-aware decisions without a separate adapter lookup.
   > Capabilities are fixed at registration and never change during the session's lifetime.

5. What problem does `SessionGateway` solve that `JsonlSessionStore` does not?
   > `JsonlSessionStore` is a historical archive: it stores every message and trace event for
   > every session, forever. It cannot answer "which sessions are active right now" without
   > reading every file and inferring activity from timestamps. `SessionGateway` maintains a
   > live, explicit list of active sessions with O(1) lookup. The two are complementary:
   > history vs. presence.

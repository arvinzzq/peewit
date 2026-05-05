# Phase 7 Multi-Entry Adapters Plan

Status: In Progress
Date: 2026-05-05

Simplified Chinese version: [phase-7-multi-entry-adapters.zh-CN.md](./phase-7-multi-entry-adapters.zh-CN.md)

## Progress

Status: In Progress

Completed commits:

- [ ] Part A: Design docs — adapter interface and gateway concept
- [ ] Part B: `packages/adapters` — `AdapterCapabilities` interface
- [ ] Part C: `packages/config` — `resolveSessionsDirectory()` helper
- [ ] Part D: Web durable sessions — `JsonlSessionStore` in web server
- [ ] Part E: Web session management UI — sessions list page

## 1. Purpose

Phase 7 formalizes the adapter boundary that Phase 6 created informally.

Phase 6 proved that CLI and Web can share one Agent Core. Phase 7 makes that sharing explicit:

- Define what capabilities an adapter can declare.
- Provide a shared helper for session directory resolution so CLI and Web use the same path.
- Switch Web sessions to the same durable `JsonlSessionStore` used by CLI.
- Add a session management UI to the Web app so users can create and resume sessions.
- Document the early gateway direction for Phase 10.

## 2. Scope

This phase includes:

- `packages/adapters`: new package exporting `AdapterCapabilities` and canonical capability constants.
- `packages/config`: `resolveSessionsDirectory()` exported helper; CLI uses it instead of its private copy.
- `apps/web`: switch from `InMemorySessionStore` to `JsonlSessionStore` (shared store at server start).
- `apps/web`: `GET /api/sessions` returns sessions from the store with metadata; `GET /api/sessions/:id` returns single session metadata.
- `apps/web`: session list page in React UI — browse existing sessions, create new session, resume session.
- `docs/architecture/adapters.md` and `docs/architecture/gateway.md`.

This phase does not include:

- Multi-device sync.
- Full OpenClaw-style node network.
- Background adapters (Phase 8).
- Remote adapter registration.
- Auth or multi-user sessions.

## 3. Architecture Summary

### AdapterCapabilities

Each adapter declares whether it can:

- Display token-by-token streaming (`streaming: boolean`)
- Show interactive approval UI (`approvalPrompts: boolean`)
- Run without a live user connection (`background: boolean`)

Canonical constants are provided for CLI, Web, and future background adapters.

### resolveSessionsDirectory

Config package gains a public `resolveSessionsDirectory(config, env)` helper that expands `~/` using `HOME` from the provided env or `process.env.HOME`. Previously this logic was duplicated as a private function in the CLI. After this phase both CLI and Web use the same exported helper.

### Durable Web Sessions

Before Phase 7, the Web server uses `InMemorySessionStore` — sessions are lost on restart. Phase 7 creates one shared `JsonlSessionStore` at server start, pointed at the same directory as the CLI. The in-memory `sessions` map retains only transient runtime state (runtime, approvalResolver, traceStore). Persistent session data lives in the store.

This means:

- A session created via Web is visible in `arvinclaw sessions`.
- A session created via CLI can be resumed in the Web UI.
- Server restart does not lose session history.

### Session Management UI

The Web UI gains a sessions page shown when no session is active. It lists existing sessions from `GET /api/sessions` and offers a "New Session" button. Clicking an existing session resumes it.

## 4. Acceptance Criteria

- `packages/adapters` exports `AdapterCapabilities`, `AdapterStorageType`, `CLI_CAPABILITIES`, `WEB_CAPABILITIES`, and `BACKGROUND_CAPABILITIES`.
- `packages/config` exports `resolveSessionsDirectory`.
- CLI uses `resolveSessionsDirectory` from config (private function removed).
- Web server uses `JsonlSessionStore` at the configured sessions directory.
- `GET /api/sessions` returns sessions with `id` and `updatedAt` fields.
- `GET /api/sessions/:id` returns single session metadata.
- Web UI shows a sessions list page before a session is selected.
- Sessions created in CLI are visible in the Web UI session list.
- `pnpm run check` passes after each part.

## 5. Non-Goals

- No full OpenClaw-style node network.
- No complex multi-device sync.
- No auth or multi-user isolation.
- No remote adapter registration protocol.

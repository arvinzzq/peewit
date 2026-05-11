# Phase 16: Sandbox and Plugin Runtime

Status: Complete (all 7 steps shipped — Steps 3, 4, 6 landed in Phase 16b)
Date: 2026-05-12

Simplified Chinese version: [phase-16-sandbox-and-plugin-runtime.zh-CN.md](./phase-16-sandbox-and-plugin-runtime.zh-CN.md)

## Progress

Status: Complete — three sandbox backends ship behind a single interface; `vole doctor` covers read-only checks AND idempotent remediations.

Completed commits:

- [x] Step 1: docs(arch) Phase 16 forward-looking callouts on `sandboxing.md` + `plugin-system.md` (bilingual) — `8483d69`
- [x] Step 2: feat(permissions) `SandboxBackend` interface + `WorkspaceSandbox` reference backend — `ef696e3`
- [x] Step 3 (16b): feat(permissions) `DockerSandbox` per-execution container with workspace mounted read-only + network deny by default — `38e912f`
- [x] Step 4 (16b): feat(permissions) `WorkerThreadSandbox` with timeout + memory cap; untrusted-skill routing seam via `SandboxBackend` — `38e912f`
- [x] Step 5: feat(cli) `vole doctor` read-only checks — `89b85df`
- [x] Step 6 (16b): feat(cli) `vole doctor --fix` idempotent remediations (stale .lock files, stuck subagents, orphan TaskFlow children) — `90f6c4f`
- [x] Step 7: docs mark Phase 16 complete + roadmap update — (this commit)

## 1. Purpose

Phase 16 turns sandboxing from "a `VOLE_SANDBOX=true` boolean that pins shell cwd" into a real backend system, and turns the plugin / skill ecosystem from "loaded markdown that influences prompts" into a runtime that can safely execute third-party code. It also introduces `vole doctor` as a self-maintenance command for the kinds of stale state OpenClaw documents around tombstones and rapid re-wedge.

Phase 16 depends on Phase 11 (gateway and lanes) for the lifecycle hooks where sandboxing decisions are enforced, and on Phase 15 (multi-agent identity) for per-agent sandbox policy.

## 2. Scope

This phase includes:

- `SandboxBackend` interface in `packages/permissions` (the closest home for execution-boundary decisions).
- Backends: `WorkspaceSandbox` (current behavior, refactored to backend), `DockerSandbox` (per-execution container), `WorkerThreadSandbox` (JS-only tools and untrusted skills).
- `sandbox.backend` config field with per-tool override.
- Worker-thread-isolated plugin / skill runtime: untrusted skills execute in a worker thread with `timeout` and `maxMemoryMB` caps; throwing skills do not crash the main process.
- `vole skills trust <name>` already exists from Phase 9; Phase 16 makes trust meaningful (trusted = inline, untrusted = worker thread).
- `vole doctor` and `vole doctor --fix` for self-maintenance: stale subagent records, orphan TaskFlow rows, residual lock files, mismatched session key tree.
- Architecture doc `sandboxing.md` rewritten to describe the backend system.

This phase does not include:

- firejail / bubblewrap integration on Linux (deferred; macOS has no native equivalent).
- cgroup-level CPU / memory caps directly (Docker covers this when needed).
- Mandatory sandboxing for all tools (opt-in by config or risk class).
- Container image management beyond pulling a default base image.

## 3. Architecture Summary

### SandboxBackend Interface

```ts
interface SandboxBackend {
  name: "workspace" | "docker" | "worker";
  execute(command: SandboxCommand, options: SandboxOptions): Promise<SandboxResult>;
  available(): Promise<boolean>;
}

interface SandboxOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxMemoryMB?: number;
  network?: "allow" | "deny";
}
```

Tools that run code (`run_shell`, future code-eval tools, untrusted skills) call `sandbox.execute(...)` rather than spawning processes directly. The chosen backend depends on config plus the tool's risk class.

### Docker Backend

`DockerSandbox` runs each command in an ephemeral container:

- Default image configurable (`sandbox.docker.image`, default `node:lts-alpine` or similar small image).
- Mount the workspace read-only by default; tools that need to write list the paths explicitly.
- Network `deny` by default; allow per command.
- Container lifetime is one execution; logs and exit code captured.
- Backend reports `available(): false` when Docker is not installed, letting the system gracefully degrade.

### Worker Thread Plugin Runtime

Skills marked `trusted: true` execute inline; untrusted skills run in a `worker_threads.Worker`:

- Worker boots with a restricted module map (no `node:fs`, no arbitrary network).
- Tool calls inside the worker are RPC'd back to the main process, which re-runs them through the normal permission policy.
- Worker terminate on timeout or memory cap.
- Exceptions in the worker do not propagate to the main event loop.

This makes installing a stranger's skill safe enough to be a routine action rather than a security decision.

### Doctor Tool

`vole doctor` performs read-only health checks. `vole doctor --fix` applies remediations. Checks include:

- Stale subagent TaskFlow rows whose runs exceeded `staleRunWindowMinutes`.
- Orphan TaskFlow children whose parent is gone.
- Residual `.lock` files whose owning PID is dead.
- Session JSONL files that look truncated relative to their SQLite mirror.
- Skill metadata pointing to missing files.

Each check emits a human-readable diagnostic plus a `--fix` action. A summary line at the end mirrors `openclaw doctor` UX.

## 4. Commit Sequence

1. **docs**: this plan + zh-CN, `sandboxing.md` rewrite + zh-CN, `plugin-system.md` update + zh-CN, roadmap update — docs:check must pass.
2. **feat(permissions)**: `SandboxBackend` interface, `WorkspaceSandbox` refactored to backend, tests.
3. **feat(permissions)**: `DockerSandbox` backend; integration test gated on Docker availability.
4. **feat(permissions,skills)**: `WorkerThreadSandbox` backend; untrusted skills routed through it; tests covering throw / timeout / memory cap.
5. **feat(cli)**: `vole doctor` read-only checks.
6. **feat(cli)**: `vole doctor --fix` actions.
7. **docs**: mark Phase 16 complete.

## 5. Acceptance Criteria

- `pnpm run check` and `pnpm run check:bundle` pass at every commit.
- A test installs a synthetic untrusted skill that throws; the main process does not crash and the skill is reported as failed.
- A test installs a synthetic untrusted skill that allocates a large buffer; the worker terminates and surfaces a `memory_exceeded` error.
- `sandbox.backend: "docker"` configured: `run_shell` executes inside a container with workspace mounted read-only (gated test, skipped if no Docker).
- `vole doctor` detects an injected stale subagent row and reports it; `vole doctor --fix` resolves it.
- Worker-thread skill making a tool call goes through the normal permission policy (test asserts policy was consulted).

## 6. Non-Goals

- No firejail / bubblewrap integration.
- No cgroup direct usage.
- No mandatory sandboxing of every tool.
- No container orchestration beyond single ephemeral runs.
- No remote sandbox dispatch.

## 7. Related Documents

- [Phase 11 Gateway and Lanes](./phase-11-gateway-and-lanes.md)
- [Phase 15 Channels and Multi-Agent Identity](./phase-15-channels-and-multi-agent-identity.md)
- [Sandboxing](../architecture/sandboxing.md)
- [Plugin System](../architecture/plugin-system.md)
- [Roadmap](../roadmap/overview.md)

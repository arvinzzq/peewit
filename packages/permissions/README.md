# Permissions Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/permissions` owns the **permission policy boundary**: given a tool action and the current autonomy mode, it produces a decision (`allow`, `ask`, or `deny`) with a human-readable reason. It never executes tools, renders UI, or calls APIs. Its only output is a `PermissionDecision`.

```
AgentRuntime
    │  for each tool call:
    ▼
PermissionPolicy.evaluate({ mode, action })
    │
    ▼
PermissionDecision { decision, risk, reason }
    │
    ├─ "allow" → execute immediately
    ├─ "ask"   → emit approval_requested, call ApprovalResolver
    └─ "deny"  → fail the run
```

## Core Concepts

### Three Dimensions of a Permission Decision

Every decision is the product of two inputs:

1. **`AutonomyMode`** — the user's chosen level of agent autonomy:
   - `"observe"`: the agent can think and plan but should ask before all external actions.
   - `"confirm"` (default): the agent runs low-risk actions automatically, asks for medium/high.
   - `"auto"`: the agent runs low and medium-risk actions automatically, asks only for high-risk.

2. **`PermissionRiskLevel`** — the inherent risk level declared by the tool:
   - `"low"`: read-only, reversible, no side effects (e.g. `read_file`, `list_directory`).
   - `"medium"`: writes or calls with bounded impact (e.g. `write_file`, `spawn_subagent`).
   - `"high"`: broad or irreversible impact (e.g. `run_shell`).
   - `"blocked"`: permanently denied, regardless of mode (tools that should never run).

### Decision Matrix

`DefaultPermissionPolicy.evaluate()` implements this matrix:

| Mode \ Risk | `"blocked"` | `"low"` | `"medium"` | `"high"` |
|---|---|---|---|---|
| `"observe"` | deny | ask | ask | ask |
| `"confirm"` | deny | allow | ask | ask |
| `"auto"` | deny | allow | allow | ask |

Key invariants:
- `"blocked"` is always `"deny"`, regardless of mode.
- `"observe"` always produces `"ask"` for non-blocked tools.
- `"auto"` only escalates to `"ask"` for `"high"` risk.

### PermissionDecision

```typescript
interface PermissionDecision {
  decision: "allow" | "ask" | "deny";
  risk: PermissionRiskLevel;
  reason: string;  // human-readable, safe to include in traces
}
```

The `reason` field is designed to be included in `tool_call_permission_evaluated` events without leaking sensitive information.

### PermissionPolicy Interface

```typescript
interface PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision;
}
```

`PermissionPolicy` is synchronous and has no side effects. This makes it trivially testable and safe to call in the hot path of the agent loop. Custom implementations can add allow-lists, rule-based overrides, or organization-specific logic without changing the runtime.

### AlwaysAllowPolicy

`AlwaysAllowPolicy` is the null implementation of `PermissionPolicy`. It returns `allow` for every non-blocked tool action regardless of risk level and autonomy mode. `"blocked"` risk tools are still denied — that invariant holds across all policies.

```typescript
const agent = createAgent({
  model: provider,
  tools: [readFileTool, shellTool],
  permissions: new AlwaysAllowPolicy(),  // all tool calls execute without prompts
});
```

Use when: Layer 1 tests that need tool calls to execute without configuring an `ApprovalResolver`. Also useful in sandboxed evaluation environments where every registered tool is considered safe by definition.

### Sandbox Backends (Phase 16)

Permissions also owns the **execution-boundary abstraction**. `SandboxBackend` is the interface tools call when they need to run code outside their own address space (shell commands, untrusted skills). Each backend reports a stable `name` and implements `available()` for graceful degradation and `execute(command, options)` for actual work.

```typescript
interface SandboxBackend {
  readonly name: "workspace" | "docker" | "worker";
  execute(command: SandboxCommand, options?: SandboxOptions): Promise<SandboxResult>;
  available(): Promise<boolean>;
}
```

`SandboxResult` is a discriminated union: completed runs report exit code + stdout + stderr + duration; non-completed runs report a reason (`"timeout" | "rejected" | "unavailable"`) and a human-readable message. Callers always see explicit outcomes — there are no thrown exceptions for routine sandbox refusals.

`WorkspaceSandbox` is the default backend and the reference implementation:
- Pins `cwd` to the workspace root, refusing any requested `cwd` outside it.
- Rejects shell snippets matching workspace-escape heuristics (`cd /`, `cd ~`, `/../`).
- Honors `timeoutMs` and reports timeouts as `{ completed: false, reason: "timeout" }`.
- Reports `available(): true` unconditionally; it has no external dependency.

`WorkerThreadSandbox` (Phase 16b) runs JS snippets inside `node:worker_threads`. The worker boots from an inline bootstrap that wraps the snippet in an async function, posts the stringified result back, and is bounded by `timeoutMs` (default 5s) plus `maxMemoryMB` (default 64MB, mapped to `resourceLimits.maxOldGenerationSizeMb`). Throwing snippets surface as `{ completed: true, exitCode: 1, stderr }`; timeouts surface as `{ completed: false, reason: "timeout" }`.

`DockerSandbox` (Phase 16b) runs each command in an ephemeral container (`docker run --rm`). The workspace is mounted read-only at `/workspace`; network is denied by default and opted in via `SandboxOptions.network: "allow"`. `available()` probes the docker daemon and `execute()` resolves to `{ completed: false, reason: "unavailable" }` when Docker is not installed, so callers degrade gracefully.

## Implementation Principles

### Why a Separate Package

The permission decision is a **policy concern**, not a tool concern or a runtime concern. Separating it allows:

1. **Tools stay ignorant of policy**: `ExecutableTool.risk` is metadata; tools never check "am I allowed to run?"
2. **Runtime stays ignorant of policy logic**: `AgentRuntime` calls `evaluate()` and reacts to the decision; it does not implement policy rules.
3. **Policy is independently testable and swappable**: custom organizations can inject alternative `PermissionPolicy` implementations.

### Autonomy Mode Normalization

`AgentRuntime` calls a private `normalizeAutonomyMode()` helper that maps any unknown string to `"confirm"`. This prevents a misconfigured mode from bypassing the permission check.

### The "blocked" Risk Level

Tools with `risk: "blocked"` are designed to be permanently unavailable. They may exist in the tool registry for introspection purposes (e.g. showing users what capabilities are blocked) but will never execute. The policy returns `"deny"` unconditionally — no approval resolver is consulted.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the permissions package, export entrypoint, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the permissions package (no dependencies on other workspace packages). |
| `src/index.ts` | Permission policy + sandbox backends | All exports: `AutonomyMode`, `PermissionRiskLevel`, `PermissionDecisionType`, `PermissionAction`, `PermissionEvaluationInput`, `PermissionDecision`, `PermissionPolicy`, `DefaultPermissionPolicy`, `AlwaysAllowPolicy`, plus the Phase 16 sandbox surface: `SandboxBackend`, `SandboxBackendName`, `SandboxCommand`, `SandboxOptions`, `SandboxResult`, `WorkspaceSandboxOptions`, `WorkspaceSandbox`. |
| `src/index.test.ts` | Permission + sandbox tests | Covers every cell of the decision matrix (observe/confirm/auto × low/medium/high/blocked) and the `WorkspaceSandbox` contract (availability, benign command, escape rejection, cwd containment, timeout, non-zero exit). |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

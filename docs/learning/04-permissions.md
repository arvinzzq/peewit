# Module 04: @vole/permissions

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `04-permissions.zh-CN.md` (create alongside this file)

Related source: `packages/permissions/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [02-core.md](./02-core.md) so you already know where `PermissionPolicy.evaluate()`
is called and what happens with each decision.

**Before reading**: Read `packages/permissions/src/index.ts` in full — it is only 82 lines.
Then read this document to understand the design decisions.

**Focus questions**:
- Why is `evaluate()` synchronous when it produces decisions that may lead to user interaction?
- What is the difference between `blocked` (a risk level) and `deny` (a decision type)?
- In `auto` mode, which risk levels are automatically allowed?
- Who handles the user interaction when the decision is `ask`?

**Checkpoint**: You understand this module when you can fill in the full decision matrix
(mode × risk → decision) from memory and explain why each cell is what it is.

## 1. What This Module Does

`@vole/permissions` evaluates whether a tool action should be automatically allowed, paused
for human approval, or denied. It takes an autonomy mode and a tool's risk level as inputs
and returns a decision with a trace-safe reason.

It makes no network calls, performs no IO, interacts with no user, and runs no async code.

## 2. Why It Exists

The model can request any registered tool. Without a gate between "model requests" and
"tool executes," one misconfigured prompt or injected instruction could delete files,
exfiltrate secrets, or execute destructive commands.

`@vole/permissions` is that gate. It is a separate package — not logic embedded in core —
because the same policy must work identically across CLI, web, background scheduler, and
test environments. Keeping it pure and dependency-free makes it trivially testable and
portable.

## 3. Public Interface

```ts
type AutonomyMode = "observe" | "confirm" | "auto"
type PermissionRiskLevel = "low" | "medium" | "high" | "blocked"
type PermissionDecisionType = "allow" | "ask" | "deny"

interface PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision
}

interface PermissionEvaluationInput {
  mode: AutonomyMode
  action: {
    kind: "tool"
    name: string
    summary: string
    risk: PermissionRiskLevel
  }
}

interface PermissionDecision {
  decision: PermissionDecisionType
  risk: PermissionRiskLevel  // passes through the input risk
  reason: string             // trace-safe explanation
}

class DefaultPermissionPolicy implements PermissionPolicy
```

The `PermissionPolicy` interface is what `AgentRuntime` depends on. `DefaultPermissionPolicy`
is the bundled implementation. Custom policies can replace it via dependency injection.

## 4. Implementation Walkthrough

`DefaultPermissionPolicy.evaluate()` implements a mode × risk decision matrix:

| mode \ risk | `low` | `medium` | `high` | `blocked` |
|---|---|---|---|---|
| `observe` | ask | ask | ask | **deny** |
| `confirm` | **allow** | ask | ask | **deny** |
| `auto` | **allow** | **allow** | ask | **deny** |

The logic evaluates in priority order:

1. **`blocked` wins unconditionally** — if `risk === "blocked"`, return `deny` regardless
   of mode. No mode can override a blocked tool.

2. **`observe` mode asks for everything** — the purpose of `observe` is full transparency;
   every action pauses for confirmation, even low-risk ones.

3. **`auto` mode allows low and medium, asks for high** — the intent of `auto` is minimal
   interruption, but high-risk actions still require human sign-off.

4. **`confirm` mode (default) allows only low, asks for medium and high** — the safest
   interactive mode: routine reads run automatically, writes and shell access require approval.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Tool policy evaluation | `PermissionPolicy.evaluate()` | Same concept |
| `effective-tool-policy.ts` | `DefaultPermissionPolicy` | Mode × risk matrix |
| Autonomy / strictness levels | `AutonomyMode` | OpenClaw has more levels; Vole uses three |

OpenClaw's tool policy has more granularity (per-tool overrides, workspace-level config).
Vole's `DefaultPermissionPolicy` is intentionally minimal — a single matrix, no config
surface. Custom policies via the interface provide the extension point.

## 6. Key Design Decisions

**`evaluate()` is synchronous**

Synchronous evaluation is a deliberate constraint. It forces this package to be a pure
decision function with no side effects. User interaction — asking "do you approve?" — belongs
to `ApprovalResolver` in the adapter layer. The two concerns are separated:

- `PermissionPolicy.evaluate()` → returns `ask` / `allow` / `deny`
- `ApprovalResolver.resolve()` (in core, called by adapters) → handles the UI

This means the same `PermissionPolicy` works identically in CLI, web, and headless
background runs where there is no user to ask.

**`blocked` is a risk level, not a decision type**

`PermissionRiskLevel` includes `"blocked"`. `PermissionDecisionType` does not — it only
has `"allow" | "ask" | "deny"`.

When a tool has `risk: "blocked"`, the policy maps it to `decision: "deny"`. This is
intentional: `blocked` is a property of the tool definition (set at registration time),
while `deny` is a runtime outcome. Keeping them in separate type domains prevents confusion
between "this tool is configured as off-limits" and "this specific request was rejected."

**`reason` is for trace, not for the model**

The `reason` string in `PermissionDecision` is not shown to the user and never sent to the
model. It exists for trace events and debugging: `"High-risk action requires approval in
auto mode."` explains why a run was paused or denied without requiring the reader to
reconstruct the decision matrix mentally.

**`risk` is passed through to the decision**

`PermissionDecision` includes the input `risk` level. This lets core emit
`tool_call_permission_evaluated` events and adapters show approval prompts without
needing to look up the tool definition again. The decision carries its own context.

## 7. Testing Approach

Tests are in `packages/permissions/src/index.test.ts`. Five tests cover the full matrix:

- `confirm` mode: low → allow, medium/high → ask
- `observe` mode: all non-blocked → ask
- `auto` mode: low/medium → allow, high → ask
- `blocked` risk: deny in every mode

No fakes or mocks needed — `DefaultPermissionPolicy` is a pure function. Tests call
`evaluate()` directly with constructed inputs and assert on the returned decision.

## 8. Insights

**The smallest package carries the most important guarantee.** At 82 lines, this is the
shortest package in the codebase, but it is the reason the agent cannot be trivially
weaponised by a malicious prompt. The simplicity is a feature: less code, fewer bugs,
easier audit.

**`observe` mode is for learning, not for security.** `observe` pauses before every action
including low-risk reads. This is useful when someone is learning how the agent behaves —
they see each step before it executes. It is not a "safer" mode than `confirm`; it is a
more transparent one.

**`auto` mode allows `medium` risk.** This surprises new readers. In `auto` mode, only
`high` and `blocked` require approval. `medium` risk actions (typically file writes) run
automatically. This is intentional for background/scheduled use cases where there is no
human available to approve routine operations.

**Custom policies are first-class.** `AgentRuntime` accepts any `PermissionPolicy`
implementation. You could build a policy that allows specific tool names, denies based on
path patterns, or requires approval only during certain hours — all without touching core.

## 9. Review Questions

1. Why is `evaluate()` synchronous? What would be the architectural consequence of making
   it `async`?
   > Async would imply IO or waiting — most likely waiting for user input. That would merge
   > the "evaluate" and "interact" responsibilities into one package, making it impossible
   > to use the same policy in headless/background contexts where there is no user.

2. In `auto` mode, a tool with `risk: "medium"` is requested. What is the decision?
   > `allow`. In `auto` mode only `high` and `blocked` require approval. Medium-risk actions
   > run automatically. This is intentional for non-interactive background use cases.

3. What is the difference between `blocked` (a `PermissionRiskLevel`) and `deny`
   (a `PermissionDecisionType`)?
   > `blocked` is set on the tool definition at registration time — it means this tool should
   > never execute. `deny` is a runtime decision outcome that can also result from a user
   > refusing an `ask`. They occupy different type domains: one describes a tool property,
   > the other describes a runtime outcome.

4. In `observe` mode, a tool with `risk: "low"` is requested. What is the decision?
   > `ask`. `observe` mode pauses before every non-blocked action regardless of risk level.
   > Its purpose is full transparency, not automation.

5. What is the `reason` field in `PermissionDecision` used for?
   > Trace events and debugging. It is never sent to the model or shown to the user as a
   > permission explanation. It explains the decision in human-readable form for developers
   > reading logs or trace output.

6. `AgentRuntime` uses `DefaultPermissionPolicy` by default but accepts any `PermissionPolicy`.
   Describe a custom policy that would be useful in a specific scenario.
   > Example: a read-only policy that allows only tools with `risk: "low"` and denies
   > everything else — regardless of mode. Useful for a "safe exploration" mode where the
   > agent can read files and search but cannot write, execute, or make network calls.

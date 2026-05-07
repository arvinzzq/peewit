# Module 11: @vole/adapters

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `12-adapters.zh-CN.md`

Related source: `packages/adapters/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 4 (Extension Systems) in the [learning guide](./guide.md).
Read it after [06-tools.md](./06-tools.md) — tool profiles are the main concept here, and
they only make sense once you understand the tool registry.

**Before reading**: Read `packages/adapters/src/index.ts` in full (123 lines). Notice it has
zero runtime logic — no functions that do computation beyond `filterToolsByProfile`. Everything
else is type definitions and constants.

**Focus questions**:
- `AdapterCapabilities` has three boolean fields. Which combination is structurally impossible,
  and why? Where is this invariant enforced?
- `TOOL_PROFILES.full` has an empty `allowedTools`. How does `filterToolsByProfile` handle this?
  Why is this the right default?
- `messaging` profile has no `write_file`. `background` profile has no `run_shell`. What threat
  model does each exclusion address?

**Checkpoint**: You understand this module when you can explain why this package contains no
runtime logic, and where the decision of which profile to use actually happens.

## 1. What This Module Does

**Plain language**: Think of adapters as job descriptions posted outside a room. Before anyone
enters, they read their role: "CLI engineer: you can stream output and ask questions." "Web
browser: same." "Night shift bot: no talking, no asking questions." The adapters package is
just those job descriptions — it does not hire anyone or run the room.

**Technical summary**: `@vole/adapters` is a pure declaration package. It exports
`AdapterCapabilities` (what each surface can do), three capability constants (`CLI_CAPABILITIES`,
`WEB_CAPABILITIES`, `BACKGROUND_CAPABILITIES`), `ToolProfile` (a named tool set restriction),
`TOOL_PROFILES` (the four profile definitions), and `filterToolsByProfile` (a pure filter
function). No imports from other `@vole/*` packages. No side effects.

## 2. Why It Exists

Without a shared declaration package, each adapter (CLI, Web, background) would silently
diverge in what tools and capabilities they advertise. A background adapter might accidentally
include `run_shell`; a messaging adapter might include `write_file`. Bugs would be discovered
at runtime.

By centralising the declarations, the invariants can be tested once and relied on everywhere.
The architecture also gains a vocabulary: "this session uses the `messaging` profile" is a
precise, testable statement.

## 3. Public Interface

```ts
// What an adapter surface can do
interface AdapterCapabilities {
  streaming: boolean;       // can display token_delta events live
  approvalPrompts: boolean; // can show interactive approval UI
  background: boolean;      // can run without a live user connection
}

// Three capability constants
const CLI_CAPABILITIES:        AdapterCapabilities  // streaming+approvals, not background
const WEB_CAPABILITIES:        AdapterCapabilities  // streaming+approvals, not background
const BACKGROUND_CAPABILITIES: AdapterCapabilities  // background only, no streaming/approvals

// Tool profile name
type ToolProfile = "coding" | "full" | "messaging" | "background"

// Profile definition
interface ToolProfileDefinition {
  name: ToolProfile
  description: string
  allowedTools: string[]  // empty = no restriction (full profile)
}

// All profiles
const TOOL_PROFILES: Record<ToolProfile, ToolProfileDefinition>

// Filter tool array to the allowed set for a profile
function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[]
```

## 4. Implementation Walkthrough

### AdapterCapabilities: the impossible combination

The three booleans encode a structural invariant: **`background: true` and `approvalPrompts: true`
cannot both be set**. A background adapter runs unattended — there is no user to answer an
approval prompt. If a background adapter had `approvalPrompts: true`, any tool call that
requires confirmation would block forever.

The tests enforce this invariant explicitly:

```ts
test("a background-capable adapter cannot approve interactively", () => {
  for (const caps of [BACKGROUND_CAPABILITIES]) {
    if (caps.background) {
      expect(caps.approvalPrompts).toBe(false);
    }
  }
});
```

`AdapterStorageType` (`"in-memory" | "jsonl" | "sqlite"`) is a companion type that describes
the session storage backend. It is informational — adapters don't choose storage at runtime,
the entrypoint injects a `SessionStore`. The type exists for configuration and documentation.

### Tool profiles: four named tool sets

| Profile | Use case | Notable exclusions |
|---|---|---|
| `full` | All tools available | None — `allowedTools` is empty |
| `coding` | File system + shell for code tasks | `read_web_page`, `memory_search/get` |
| `messaging` | Read-only information tasks | `write_file`, `run_shell`, `spawn_subagent` |
| `background` | Unattended background tasks | `run_shell`, `read_web_page` |

The `full` profile uses an empty `allowedTools` array as a sentinel — `filterToolsByProfile`
returns the input unchanged when the array is empty. This is simpler than a special-case branch
or a `null` value.

### filterToolsByProfile: pure generic filter

```ts
export function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[] {
  const def = TOOL_PROFILES[profile];
  if (def.allowedTools.length === 0) return tools;
  return tools.filter((t) => def.allowedTools.includes(t.name));
}
```

Generic over `T extends { name: string }` — the caller preserves their concrete tool type
without casting. The `full` profile early-returns. All other profiles filter by name membership.

### Who decides which profile to use?

The `@vole/adapters` package declares the profiles but never selects one. Profile selection
happens in the CLI entrypoint:

```ts
// apps/cli/src/index.ts
const filteredTools = config.runtime.toolProfile !== undefined
  ? filterToolsByProfile(allTools, config.runtime.toolProfile as ToolProfile)
  : allTools;
```

The profile comes from the `VOLE_TOOL_PROFILE` environment variable (via `@vole/config`).
If unset, all tools are available. This keeps the policy decision at the entrypoint, not inside
the declaration package.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Surface capability declarations | `AdapterCapabilities` constants | Same three-boolean model |
| Named tool profiles per surface | `TOOL_PROFILES` record | Same concept; OpenClaw has more profiles |
| Profile-based tool filtering | `filterToolsByProfile` | Identical pattern |
| Background adapter constraints | `BACKGROUND_CAPABILITIES` + test invariant | Same — background cannot have approval prompts |

## 6. Key Design Decisions

**Pure declarations, no runtime logic**

`@vole/adapters` has no workspace package dependencies. It cannot import `@vole/tools` (which
would create a circular dependency once tools import capabilities). The separation also means
the package can be read as documentation: the entire adapter contract fits in one screen.

**Empty allowedTools for `full` instead of `null`**

Using an empty array as a sentinel avoids a nullable type (`string[] | null`) and keeps
`filterToolsByProfile` simple. The cost: a caller looking at `TOOL_PROFILES.full.allowedTools`
sees `[]` and might be confused. The README and type doc clarify this.

**Invariant tested, not type-enforced**

`background: true` with `approvalPrompts: true` is structurally invalid but TypeScript cannot
prevent it without a discriminated union. The test acts as the enforcement point. This is a
deliberate trade-off: a discriminated union would complicate the type and every callsite.

## 7. Testing Approach

Tests are in `packages/adapters/src/index.test.ts`. All tests are pure constant checks — no
filesystem, no async, no fakes:

- `AdapterCapabilities`: verifies the three constants' boolean fields, structural conformance,
  and the background-cannot-have-approvalPrompts invariant
- `AdapterStorageType`: verifies the three valid string literals
- `TOOL_PROFILES`: verifies all four profiles exist, `full` has empty `allowedTools`, and
  each profile includes/excludes the right tools
- `filterToolsByProfile`: verifies `full` returns all tools, and each restricted profile
  filters correctly

## 8. Insights

**`@vole/adapters` is a vocabulary package.** Its primary value is not code — it is names and
constraints. "This session uses the `messaging` profile" is meaningful precisely because the
package defines what `messaging` means. Without the package, that sentence would require
checking a list somewhere in CLI source code.

**Profiles are a use-case concern, not a permission concern.** `@vole/permissions` decides
whether a specific tool call is allowed given the current autonomy mode. `@vole/adapters`
decides which tools are even registered for this type of session. They are orthogonal: a
`messaging` session still runs the permission policy on its smaller tool set.

**The package has no state, so it has no bugs.** All functions are pure; all exports are
constants. The only possible failures are wrong values in the constants, which the tests catch.
This makes `@vole/adapters` the most stable package in the codebase — it almost never needs
to change.

## 9. Review Questions

1. What makes `background: true, approvalPrompts: true` an impossible combination, and how
   is this enforced?
   > A background adapter runs unattended — no user exists to answer an approval prompt.
   > If `approvalPrompts: true`, any tool call requiring confirmation would block forever.
   > TypeScript cannot prevent this with the current flat interface, so a test enforces it:
   > any capability constant with `background: true` must have `approvalPrompts: false`.

2. `TOOL_PROFILES.full.allowedTools` is `[]`. What does `filterToolsByProfile` do with this?
   > The function checks `if (def.allowedTools.length === 0) return tools` and returns the
   > input unchanged. An empty list is the sentinel for "no restriction." All other profiles
   > have a non-empty list and filter by name inclusion.

3. The `messaging` profile excludes `write_file`; the `background` profile excludes `run_shell`.
   What threat does each exclusion address?
   > `messaging` excludes `write_file` because its use case is read-only information retrieval
   > — a messaging widget or read-only chatbot should never modify files. `background` excludes
   > `run_shell` because unattended shell execution with `auto` approval is high risk; a daemon
   > that runs shell commands without any human oversight can cause irreversible damage.

4. Who decides which profile a session uses, and where is that decision made?
   > The CLI entrypoint (`apps/cli/src/index.ts`) reads `config.runtime.toolProfile` (from
   > the `VOLE_TOOL_PROFILE` env var) and calls `filterToolsByProfile` on the full tool list.
   > `@vole/adapters` declares the profiles but never selects one.

5. Why does `@vole/adapters` have no workspace package dependencies?
   > Importing `@vole/tools` would create a circular dependency once tools need to reference
   > adapter types. Keeping the package dependency-free also means it can be imported by any
   > package in the monorepo without pulling in transitive dependencies. The package is pure
   > declarations — it needs no runtime imports.

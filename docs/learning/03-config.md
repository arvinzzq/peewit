# Module 02: @vole/config

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `02-config.zh-CN.md`

Related source: `packages/config/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it before or alongside any other module — `loadConfig` is called at every entry point
and the resulting `EffectiveConfig` is threaded through the entire system.

**Before reading**: Read `packages/config/src/index.ts` in full (377 lines). Notice the
three-layer loading pipeline: `applyConfig` (user/project objects) → `applyEnv` (env vars)
→ `validateConfig`. Then look at `EffectiveConfig` — it is the single typed shape everything
else depends on.

**Focus questions**:
- `applyConfig` ignores unknown keys. Why is this safer than rejecting them?
- `OPENROUTER_API_KEY` sets `provider`, `baseURL`, and resets `model` to `""`. Then
  `validateConfig` rejects an empty `model`. When does this pass and when does it fail?
- `RedactedConfigView` replaces `secrets.apiKey` with `"configured" | "missing"`. Why does
  the system need this at all?
- `resolveSessionsDirectory` expands `~/` but only for paths starting with `~/`. What
  happens to a path like `/absolute/path`?

**Checkpoint**: You understand this module when you can trace exactly what `EffectiveConfig`
looks like after `loadConfig({ env: { ANTHROPIC_API_KEY: "sk-..." } })` — every field,
including ones the caller didn't touch.

## 1. What This Module Does

**Plain language**: Think of config as the agent's briefing before it starts work. Before
anything runs, someone collects the rules: what model to use, how cautious to be, which tools
are allowed, where to store sessions. That briefing starts from safe defaults, then gets
overridden by the user's preferences, then the project's requirements, then the environment.
The result is one clean, validated document everyone reads from.

**Technical summary**: `@vole/config` loads, merges, validates, and exposes the runtime
configuration as a single `EffectiveConfig` object. It processes three input layers (user
config object, project config object, environment variables) on top of hardcoded defaults,
validates the result, and returns a fully typed config. It also provides `redactedConfig`
(safe for logging/display) and `resolveSessionsDirectory` (shared `~/` expansion for CLI
and Web). No disk reads — the caller provides all inputs.

## 2. Why It Exists

Without a central config package, every module would read `process.env` directly and make
its own decisions about defaults and validation. Bugs would scatter across the codebase.
`@vole/config` creates a single validated contract: once `loadConfig` returns, the rest of
the system never needs to touch `process.env` again.

The separation also enables testing — any test can call `loadConfig({ env: {...} })` with
a controlled environment without touching `process.env`.

## 3. Public Interface

```ts
// The canonical runtime configuration — passed everywhere
interface EffectiveConfig {
  model:       { provider, baseURL, model, temperature, maxTokens, thinkingBudget? }
  workspace:   { root }
  runtime:     { defaultMode, maxSteps, promptMode?, executionContract?, toolProfile?, sandboxed? }
  trace:       { verbosity }
  tools:       { fileSystem, shell, web }
  permissions: { allowLowRisk }
  sessions:    { directory }
  memory:      { longTermFiles, writes }
  secrets:     { apiKey }       // ← contains the real key
}

// Safe for logs/display — hides the actual key
interface RedactedConfigView extends Omit<EffectiveConfig, "secrets"> {
  secrets: { apiKey: "configured" | "missing" }
}

// Entry point — all inputs optional
function loadConfig(input?: LoadConfigInput): EffectiveConfig

// Replaces secrets with safe display value
function redactedConfig(config: EffectiveConfig): RedactedConfigView

// Expands ~/ in sessions.directory using HOME from env or process.env
function resolveSessionsDirectory(
  config: EffectiveConfig,
  env?: Record<string, string | undefined>
): string
```

## 4. Implementation Walkthrough

### Three-layer merge pipeline

```ts
export function loadConfig(input: LoadConfigInput = {}): EffectiveConfig {
  const config = cloneConfig(defaultConfig);   // 1. start from defaults
  applyConfig(config, input.userConfig);        // 2. user preferences
  applyConfig(config, input.projectConfig);     // 3. project overrides
  applyEnv(config, input.env ?? {});            // 4. environment variables
  validateConfig(config);                       // 5. reject invalid results
  return config;
}
```

Each layer is additive: later layers override earlier ones for the same field. The pipeline
always starts from a fresh clone of `defaultConfig` — shared mutable state across calls is
impossible.

### applyConfig: permissive merging

```ts
function applyObject(target: Record<string, unknown>, value: unknown): void {
  for (const [key, sectionValue] of Object.entries(value)) {
    if (key in target) {           // only known keys are applied
      target[key] = sectionValue;  // unknown keys are silently ignored
    }
  }
}
```

Unknown keys are silently ignored rather than rejected. This is intentional: a config file
written for a newer version of Vole (with extra fields) should not break an older version.
The caller's intent for known fields is still applied; extra fields are dropped.

### applyEnv: provider detection by key presence

```ts
function applyEnv(config, env) {
  if (env.OPENROUTER_API_KEY !== undefined) {
    config.model.provider = "openai-compatible";
    config.model.baseURL = "https://openrouter.ai/api/v1";
    config.model.model = "";         // ← intentionally blanked
    config.secrets.apiKey = env.OPENROUTER_API_KEY;
  }
  if (env.ANTHROPIC_API_KEY !== undefined) {
    config.model.provider = "anthropic";
    config.model.model = "claude-haiku-4-5-20251001";   // ← sets a default
    config.secrets.apiKey = env.ANTHROPIC_API_KEY;
  }
  // ...
  if (env.VOLE_API_KEY !== undefined) {
    config.secrets.apiKey = env.VOLE_API_KEY;  // ← generic override
  }
}
```

`OPENROUTER_API_KEY` blanks the model to `""` because OpenRouter requires an explicit model
name (e.g. `openai/gpt-4o`). `validateConfig` will then reject the empty model string —
unless `VOLE_MODEL` is also set. `ANTHROPIC_API_KEY` sets a default model so no extra env
var is needed for basic usage.

**Priority order**: `OPENROUTER_API_KEY` → `ANTHROPIC_API_KEY` → `VOLE_API_KEY`. Later env
vars in `applyEnv` override earlier ones, so `VOLE_API_KEY` is the generic key that works
regardless of provider.

### validateConfig: all-or-nothing

Validation runs after all layers are merged. If any field has an invalid value, a
`ConfigValidationError` is thrown and the config is discarded. The most common failure is
`OPENROUTER_API_KEY` set without `VOLE_MODEL`:

```
"No model configured. Set VOLE_MODEL=<model-name>"
```

Validation is strict on enum fields (provider, mode, verbosity) and permissive on optional
fields — only validates them when present.

### RedactedConfigView: safe for display

```ts
export function redactedConfig(config: EffectiveConfig): RedactedConfigView {
  return {
    ...config,
    secrets: {
      apiKey: config.secrets.apiKey === undefined ? "missing" : "configured"
    }
  };
}
```

The CLI uses `redactedConfig` when printing config output (`vole config`). Without this,
a `console.log(config)` would leak the API key into terminal logs, CI output, or crash
reports. The type system enforces the separation: `RedactedConfigView.secrets.apiKey` is
`"configured" | "missing"`, so it's impossible to accidentally use the redacted view as if
it contained the real key.

### resolveSessionsDirectory: shared ~ expansion

```ts
export function resolveSessionsDirectory(config, env?) {
  const directory = config.sessions.directory;
  if (!directory.startsWith("~/")) return directory;
  const home = env?.HOME ?? process.env.HOME;
  return home === undefined ? directory : join(home, directory.slice(2));
}
```

The default sessions directory is `~/.vole/sessions`. Both CLI and Web call this helper so
they always resolve to the same absolute path regardless of how each was launched. The `env`
parameter is injectable for testing — tests can simulate any `HOME` without changing
`process.env`.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Layered config (defaults → user → project → env) | `loadConfig` pipeline | Same order |
| Single validated config object passed everywhere | `EffectiveConfig` | Same pattern |
| Redacted config for display | `RedactedConfigView` + `redactedConfig()` | Same concept |
| `~` expansion for paths | `resolveSessionsDirectory` | Same utility pattern |
| Env vars as primary config mechanism | `applyEnv` with `VOLE_*` vars | Same approach |

## 6. Key Design Decisions

**No disk reads — caller provides all inputs**

`loadConfig` accepts `userConfig`, `projectConfig`, and `env` as parameters rather than
reading files itself. The CLI loads the config files and passes them in; `loadConfig` just
merges them. This keeps the package testable without filesystem mocks and free of file
path assumptions.

**Permissive merge, strict validate**

`applyConfig` ignores unknown keys (forward compatibility). `validateConfig` is strict about
known fields (immediate feedback on typos). Together: old configs work on new code, but
invalid values fail fast with a clear error.

**`secrets` section isolated in the type**

API keys live in `config.secrets.apiKey`. The rest of the config is inert data. This makes
it easy to pass `config.model`, `config.runtime`, etc. to subsystems without inadvertently
passing the key. `RedactedConfigView` enforces this at the type level — the display version
cannot accidentally leak the secret.

**`OPENROUTER_API_KEY` resets model to `""`**

This is a deliberate "force you to choose a model" design. OpenRouter supports hundreds of
models; there is no sensible default. Blanking the model string and letting `validateConfig`
fail with a helpful message is cleaner than guessing.

## 7. Testing Approach

Tests are in `packages/config/src/index.test.ts` (335 lines). All tests use dependency
injection — no real `process.env` reads:

- Default values: verifies every `EffectiveConfig` field at baseline
- Layer precedence: user config → project config → env, each overriding the previous
- Provider shortcuts: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `VOLE_API_KEY` interactions
- Individual env vars: `VOLE_MODEL`, `VOLE_DEFAULT_MODE`, `VOLE_WORKSPACE_ROOT`, etc.
- Validation failures: invalid enums, empty model, unsupported memory.writes
- `redactedConfig`: API key hidden, all other fields preserved
- `resolveSessionsDirectory`: absolute path unchanged, `~/` expanded with env HOME, fallback

## 8. Insights

**`EffectiveConfig` is the system's shared vocabulary.** Every adapter, every tool, every
runtime decision starts from this object. Changing a field name or type here requires
updates across the entire codebase. The config package is the most central dependency in
the monorepo.

**The pipeline order matters more than the individual steps.** `applyEnv` always runs last
(before validation), so environment variables always win over config files. This is the
standard "12-factor app" convention — environment is the deployment-time override, config
files are the code-time defaults.

**`memory.writes` is always `"disabled"`.** The validation rejects any other value:
```
`Invalid memory.writes "...". Only disabled is supported.`
```
This is a placeholder for a future write policy that isn't fully designed yet. Rather than
silently ignoring the field, it fails loudly to prevent confusion.

**No `process.env` in the package.** `applyEnv` takes a `Record<string, string | undefined>`
parameter. The only place `process.env` appears is in `resolveSessionsDirectory` as a
fallback for `HOME`. This makes the package fully testable and portable.

## 9. Review Questions

1. What happens if a config file sets `model.unknownField = "value"`?
   > `applyObject` only applies keys that exist in the target object (`if (key in target)`).
   > Unknown keys are silently dropped. The config is not rejected — forward compatibility
   > for config files written for newer versions of Vole.

2. `OPENROUTER_API_KEY` is set but `VOLE_MODEL` is not. What happens?
   > `applyEnv` sets `config.model.model = ""` when it sees `OPENROUTER_API_KEY`. Then
   > `validateConfig` checks `config.model.model.trim().length === 0` and throws
   > `ConfigValidationError("No model configured. Set VOLE_MODEL=...")`.

3. Both `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are set. Which provider wins?
   > `ANTHROPIC_API_KEY` wins. `applyEnv` processes `OPENROUTER_API_KEY` first, then
   > `ANTHROPIC_API_KEY` overwrites `provider`, `model`, and `apiKey`. The last write wins.
   > If `VOLE_API_KEY` is also set, it overwrites only `apiKey`, leaving the provider
   > from whichever key ran last.

4. Why does `redactedConfig` exist as a function rather than just omitting `secrets`?
   > Omitting `secrets` entirely would make it obvious something is missing, but callers
   > might still need to know whether a key is configured (to show "API key: configured"
   > vs "API key: missing" in UI). `redactedConfig` preserves the presence signal while
   > removing the actual value. The return type is `RedactedConfigView` — type-level
   > enforcement that the display version can never be used to extract the real key.

5. CLI and Web both call `resolveSessionsDirectory`. Why is this in `@vole/config` rather
   than each adapter?
   > Both adapters need to resolve the same path to ensure CLI-created sessions are visible
   > in the Web UI and vice versa. Centralising the resolution logic prevents drift — if
   > one adapter changed how it expands `~/`, sessions directories would diverge and sessions
   > would appear to be missing.

# Config Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@peewit/config` owns **configuration loading and validation**. It merges defaults, user config, project config, and environment variable overrides into a single `EffectiveConfig` object that drives all runtime behavior. It also redacts secrets before the config is displayed in traces or CLI output.

```
defaults
  + userConfig (JSON)
  + projectConfig (JSON)
  + env vars
      │
      ▼
  loadConfig()
      │
      ▼
EffectiveConfig   ←─── consumed by CLI and Web adapters
      │
      ▼
  redactedConfig()  ←─── safe to log or display
```

## Core Concepts

### EffectiveConfig

The single merged configuration object:

```typescript
interface EffectiveConfig {
  model: {
    provider: "openai-compatible" | "anthropic";
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
    thinkingBudget?: ThinkingBudget;
  };
  workspace: { root: string };
  runtime: {
    defaultMode: AutonomyMode;    // observe | confirm | auto
    maxSteps: number;
    promptMode?: PromptMode;      // full | minimal | none
    executionContract?: ExecutionContract; // default | strict-agentic
    toolProfile?: ToolProfileConfig;
    sandboxed?: boolean;
  };
  trace: { verbosity: TraceVerbosity };
  tools: { fileSystem: boolean; shell: boolean; web: boolean };
  permissions: { allowLowRisk: boolean };
  sessions: { directory: string };
  memory: { longTermFiles: LongTermMemoryFilePolicy; writes: MemoryWritePolicy };
  secrets: { apiKey: string | undefined };
}
```

### Configuration Precedence

Three layers are merged in order, with later layers winning:

1. **Defaults**: hardcoded in `defaultConfig` — `openai-compatible` provider, `gpt-4.1-mini`, `confirm` mode, `maxSteps: 12`.
2. **User config**: typically `~/.peewit/config.json` — personal preferences.
3. **Project config**: typically `.peewit/config.json` in the workspace — project-specific overrides.
4. **Environment variables**: highest precedence, applied last.

### Environment Variable Reference

| Env var | Effect |
|---|---|
| `OPENROUTER_API_KEY` | Sets provider to `openai-compatible`, baseURL to OpenRouter, sets API key |
| `ANTHROPIC_API_KEY` | Sets provider to `anthropic`, model to `claude-haiku-4-5-20251001`, sets API key |
| `PEEWIT_API_KEY` | Sets API key only (no provider change) |
| `PEEWIT_MODEL` | Overrides model name |
| `PEEWIT_BASE_URL` | Overrides model base URL |
| `PEEWIT_DEFAULT_MODE` | Overrides runtime autonomy mode (`observe`/`confirm`/`auto`) |
| `PEEWIT_WORKSPACE_ROOT` | Overrides workspace root directory |
| `PEEWIT_LONG_TERM_MEMORY` | Overrides `memory.longTermFiles` policy |
| `PEEWIT_PROMPT_MODE` | Overrides `runtime.promptMode` (`full`/`minimal`/`none`) |
| `PEEWIT_EXECUTION_CONTRACT` | Overrides execution contract (`default`/`strict-agentic`) |
| `PEEWIT_TOOL_PROFILE` | Overrides tool profile (`coding`/`full`/`messaging`/`background`) |
| `PEEWIT_SANDBOX` | Enables shell sandbox mode when `"true"` |
| `PEEWIT_THINKING_BUDGET` | Sets Anthropic thinking budget (`off`/`minimal`/`low`/`medium`/`high`/`max`/`adaptive`) |

### Provider Selection Shortcuts

The `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` shortcuts provide a zero-config path:

- Setting `OPENROUTER_API_KEY` auto-configures the OpenRouter base URL and switches to `openai-compatible` provider. You still need `PEEWIT_MODEL=openai/gpt-4o` (or similar).
- Setting `ANTHROPIC_API_KEY` auto-configures `anthropic` provider with a default Haiku model. You can override with `PEEWIT_MODEL`.

These shortcuts exist because users often set these keys in their shell profile; recognizing them avoids requiring an additional `PEEWIT_API_KEY` variable.

### Validation

`validateConfig()` is called after all layers are applied. It validates:
- `model.provider` must be `openai-compatible` or `anthropic`.
- `model.model` must be non-empty (catches the case where `OPENROUTER_API_KEY` was set but no model was specified).
- `runtime.defaultMode` must be a valid `AutonomyMode`.
- `trace.verbosity` must be a valid `TraceVerbosity`.
- `memory.longTermFiles` and `memory.writes` must be valid enum values.
- `runtime.promptMode`, `runtime.executionContract`, `runtime.toolProfile` must be valid if present.
- `model.thinkingBudget` must be a valid `ThinkingBudget` if present.

Validation throws `ConfigValidationError` (extends `Error`) so adapters can catch it separately from unexpected errors.

### Secret Redaction

`redactedConfig(config)` returns a `RedactedConfigView` that replaces `secrets.apiKey` with `"configured"` or `"missing"`. This view is safe to log, serialize into traces, or display in `--config` output.

### resolveSessionsDirectory

```typescript
function resolveSessionsDirectory(
  config: EffectiveConfig,
  env?: Record<string, string | undefined>
): string
```

Expands `~/` to `$HOME` so that the default `~/.peewit/sessions` resolves correctly on any machine. Both CLI and Web adapters call this helper, ensuring they always use the same directory regardless of where `~` is expanded.

## Implementation Principles

### Merge Strategy

`applyConfig()` merges config sections with a simple key-based override: for each key in the input section that also exists in the target, overwrite the target value. Unknown keys (typos, future fields) are silently ignored. This is intentionally permissive — schema validation would require a dependency on a schema library and would break forward compatibility.

### Why Config Is Its Own Package

Configuration loading is independent of every other domain concern. It has no dependency on `@peewit/core`, `@peewit/models`, or any other workspace package. This means the CLI or a config-only command (`peewit config show`) can import `@peewit/config` without pulling in the entire runtime stack.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the config package, public exports, and build scripts (no workspace package dependencies). |
| `tsconfig.json` | TypeScript config | Builds the config package. |
| `src/index.ts` | Config loader | All exports: `EffectiveConfig`, `RedactedConfigView`, `LoadConfigInput`, `ConfigValidationError`, `loadConfig`, `redactedConfig`, `resolveSessionsDirectory`, all type aliases (`AutonomyMode`, `PromptMode`, `ExecutionContract`, `ToolProfileConfig`, `ThinkingBudget`, etc.). |
| `src/index.test.ts` | Config tests | Protects all env var handling, precedence, provider shortcuts, redaction, and validation error messages. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

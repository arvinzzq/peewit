# Configuration System

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [configuration-system.zh-CN.md](./configuration-system.zh-CN.md)

## 1. Purpose

The configuration system defines how ArvinClaw loads non-sensitive settings, secret references, defaults, and runtime overrides.

It should let the product start simply while preventing configuration logic from leaking into Agent Core, model providers, tools, permissions, or the CLI.

Core rule:

Modules receive an effective configuration object. They do not each rediscover files, environment variables, or secrets.

## 2. Why This Module Exists

Configuration affects nearly every part of a general agent:

- Which model provider is used
- Which model is selected
- Which workspace is active
- Which tools are enabled
- Which permission mode is default
- How trace is rendered
- Where sessions are stored
- Which web/search provider is available

Without a shared configuration boundary, the first CLI implementation would scatter config reads across the codebase and make future Web UI or background runs harder to add.

## 3. Configuration Layers

MVP layers:

1. Built-in defaults
2. User config: `~/.arvinclaw/config.json`
3. Project config: `<workspace>/arvinclaw.config.json`
4. Environment variables
5. CLI flags
6. Runtime chat commands, when explicitly supported

Later layers:

- Local uncommitted project config
- Encrypted local secret store
- OS keychain integration
- Organization or team policy config

## 4. Precedence

Recommended precedence, highest wins:

```text
Runtime command
  -> CLI flag
  -> Environment variable
  -> Project config
  -> User config
  -> Built-in default
```

Project config should override user preferences only for project-scoped behavior. User config should still own user-specific defaults when the project does not specify them.

Secrets should not be copied into the final object as raw displayable values unless the consuming adapter needs a redacted status.

## 5. MVP Config Shape

The exact schema can be refined during implementation, but the MVP should cover:

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseURL": "https://api.example.com/v1",
    "model": "example-model",
    "temperature": 0.2,
    "maxTokens": 4096
  },
  "workspace": {
    "root": "."
  },
  "runtime": {
    "defaultMode": "confirm",
    "maxSteps": 12
  },
  "trace": {
    "verbosity": "explainable"
  },
  "tools": {
    "fileSystem": true,
    "shell": true,
    "web": false
  },
  "permissions": {
    "allowLowRisk": true
  },
  "sessions": {
    "directory": "~/.arvinclaw/sessions"
  }
}
```

The MVP should keep this schema small and explicit.

## 6. Secrets

Secrets must not be stored in workspace prompt files or committed project config.

MVP secret sources:

- `ARVINCLAW_API_KEY`
- `OPENROUTER_API_KEY`, which selects the OpenRouter OpenAI-compatible endpoint unless generic ArvinClaw overrides are also set

Future secret sources:

- Provider-specific keys such as `ARVINCLAW_OPENAI_API_KEY`
- Encrypted local secret file
- OS keychain
- Cloud secret provider for team deployments

The effective config may include secret presence metadata, for example "configured" or "missing", but trace and CLI config views must not print raw values.

## 7. Validation

Configuration loading should validate:

- Unknown top-level sections
- Invalid enum values
- Invalid URLs
- Invalid numeric ranges
- Missing required model settings
- Conflicting options
- Secret references that cannot be resolved

Errors should be actionable and adapter-friendly.

Example:

```text
Missing API key for provider "openai-compatible".
Set ARVINCLAW_API_KEY, OPENROUTER_API_KEY, or configure a supported secret source.
```

## 8. Redaction

Configuration values shown in CLI, trace, logs, or future Web UI must be redacted.

Redact:

- API keys
- Tokens
- Private keys
- Passwords
- Secret-like values
- Secret file paths when exposing them would be sensitive

The redaction function should be shared with trace and prompt assembly where practical.

## 9. Relationship to CLI

The CLI loads configuration during startup through a shared config loader.

The CLI may display:

- Effective model provider
- Effective model name
- Workspace root
- Default mode
- Trace verbosity
- Enabled tool categories
- Whether required secrets are configured

The CLI must not display raw secrets.

## 10. Relationship to Agent Core

Agent Core should receive runtime dependencies that have already been configured.

It can receive safe runtime settings such as:

- Autonomy mode
- Maximum loop steps
- Trace verbosity
- Workspace metadata

It should not read config files or environment variables directly.

## 11. Relationship to Model Providers

Application composition creates a provider from the effective configuration.

The provider receives:

- Base URL
- Model name
- Temperature
- Token budget
- Secret value, resolved through the secret layer

The model provider document owns provider behavior. The configuration system owns loading, validation, precedence, and redaction.

## 12. Relationship to Permissions

Configuration can influence permission defaults, but it must not silently erase safety boundaries.

Examples:

- Default mode can be `observe`, `confirm`, or `auto`.
- Low-risk auto-allow can be enabled.
- Project command policies may be added later.
- Blocked actions remain blocked unless an explicit high-trust policy exists.

Permission package owns final risk decisions.

## 13. Relationship to Workspace Files

Configuration files and workspace prompt files are different surfaces.

- `arvinclaw.config.json` configures runtime behavior.
- `AGENTS.md` and related files guide agent behavior.
- Prompt files must not store secrets.
- Prompt files must not override permission policy.

The context package may include safe config metadata in model context, but not raw secrets.

## 14. Testing Requirements

Configuration needs tests because it affects safety, startup, and reproducibility.

Required test areas:

- Layer precedence
- Default values
- Project config loading
- User config loading
- Environment variable overrides
- CLI flag overrides when added
- Schema validation
- Secret presence detection
- Redaction
- Error messages
- Ensuring Agent Core does not read config sources directly

Any iteration that changes model providers, tools, permissions, CLI startup, session storage, or workspace behavior should update config tests when relevant.

## 15. Acceptance Criteria

The MVP configuration system is successful when:

- Non-sensitive settings can be loaded from user and project config.
- Secrets are loaded from environment variables.
- Effective config has deterministic precedence.
- Invalid config produces understandable errors.
- CLI can display effective non-secret config.
- Raw secrets do not appear in trace, prompt assembly reports, or CLI config output.
- Agent Core receives configured dependencies instead of loading config itself.
- Configuration behavior is covered by unit and integration tests.

## 16. Related Documents

- [Main design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [CLI Adapter](./cli-adapter.md)
- [Model Provider](./model-provider.md)
- [Permission System](./permission-system.md)
- [Prompt Assembly](./prompt-assembly.md)
- [Workspace Files](./workspace-files.md)

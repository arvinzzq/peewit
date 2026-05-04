# Config Package

## Architecture Summary

This directory owns configuration loading and validation.
It merges defaults, user config, project config, workspace/model/memory environment overrides, and provider-specific shortcuts.
It keeps secrets redacted before configuration is shown in traces or CLI output.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the config package, public exports, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the config package. |
| `src/index.ts` | Config loader | Exports config types, defaults, merge logic, workspace/model/memory env handling, OpenRouter and Anthropic API key shortcuts, provider selection (openai-compatible or anthropic), validation, and redaction. |
| `src/index.test.ts` | Config tests | Protects defaults, precedence, workspace/model/memory env overrides, OpenRouter shortcut handling, ANTHROPIC_API_KEY shortcut handling, redaction, and validation errors. |

## Update Reminder

Update this file when the directory structure changes.

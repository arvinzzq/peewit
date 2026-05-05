# Config Agent Guide

## Responsibility

Keep configuration precedence, workspace/model/memory environment overrides, provider-specific shortcuts, validation, redaction, and the `resolveSessionsDirectory` helper here. Other packages should receive effective configuration or configured dependencies instead of reading config themselves.

## When Files Change

Update README and AGENTS files when config fields, precedence, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Config changes need tests for defaults, override precedence, workspace/model/memory environment overrides, provider-specific shortcuts, invalid values, secret redaction, and `resolveSessionsDirectory` path expansion.

## Boundaries

Do not instantiate the runtime, call providers, execute tools, or render CLI output in this package.

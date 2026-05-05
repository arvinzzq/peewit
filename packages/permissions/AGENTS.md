# Permissions Agent Guide

## Responsibility

Keep risk classification and approval policy here. Adapters can ask the user, but this package should decide whether approval is required.

## When Files Change

Update README and AGENTS files when permission responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Permission logic needs tests for risk levels, autonomy modes, allow/ask/deny decisions, blocked actions, and trace-safe explanations.

## Boundaries

Do not execute tools, render prompts, or collect user approval UI in this package.

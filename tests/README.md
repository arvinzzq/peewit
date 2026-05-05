# Tests

## Architecture Summary

This directory owns repository-level tests.
It protects cross-package rules, documentation policy, and architectural boundaries.
Package-specific behavior can live near the package under `src/*.test.ts`.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `docs-check.test.ts` | Documentation policy tests | Protects markdown links, bilingual heading counts, module docs, and source headers. |
| `package-boundaries.test.ts` | Package boundary tests | Protects workspace packages and prevents core packages from depending on CLI. |

## Update Reminder

Update this file when the directory structure changes.

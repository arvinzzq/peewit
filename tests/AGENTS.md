# Tests Agent Guide

## Responsibility

Keep repository-wide architectural and documentation tests here. Prefer package-local tests for module behavior and repository tests for cross-cutting rules.

## When Files Change

Update README and AGENTS files when repository-level tests are added, removed, or renamed.

## Testing

Tests should be deterministic, avoid real provider calls, and explain the behavior they protect through clear names.

## Boundaries

Do not put production implementation in this directory.

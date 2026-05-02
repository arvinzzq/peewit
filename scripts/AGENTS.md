# Scripts Agent Guide

## Responsibility

Keep repository automation and quality gates here. Scripts should support checks without changing project state unless explicitly designed to do so.

## When Files Change

Update README and AGENTS files when scripts are added, removed, or renamed. Update script headers when inputs, outputs, or system position change.

## Testing

Scripts with exported logic need tests under `tests/` or package-level tests. Prefer deterministic fixtures and avoid network calls.

## Boundaries

Do not hide product logic in scripts. Product behavior belongs in apps or packages.

# Adapters Agent Guide

## Responsibility

Keep adapter capability declarations, canonical constants, and the `AdapterStorageType` type here. This package is pure type definitions and constants — no runtime behavior, no I/O.

## When Files Change

Update README and AGENTS files when capability fields, constants, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Changes to capability constants need tests for correct values and interface compliance. The rule that background adapters cannot have `approvalPrompts: true` must remain tested.

## Boundaries

Do not instantiate the runtime, call providers, execute tools, read config, or render UI output in this package. This package has no dependencies on other workspace packages.

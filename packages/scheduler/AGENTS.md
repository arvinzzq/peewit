# Scheduler Agent Guide

## Responsibility

Keep background task run persistence, task definition types, and background approval policy here. Runtime code should depend on `TaskStore` and `ApprovalResolver` interfaces instead of knowing storage or policy details.

## When Files Change

Update README and AGENTS files when background task responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Scheduler logic needs tests for task run save, list, filter, update, parent directory creation, and BackgroundApprovalResolver mode behavior (auto-approve vs auto-deny).

## Boundaries

Do not assemble prompts, call model providers, execute tools, apply permission policy, or render CLI output in this package. Do not import from `apps/cli` or any adapter package.

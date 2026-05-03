# Tools Agent Guide

## Responsibility

Keep tool definitions, registry behavior, validation, and execution wrappers here. Tools can describe and run capabilities, but permission decisions must remain outside this package.

## When Files Change

Update README and AGENTS files when tool responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Tool logic needs tests for registry behavior, validation, workspace boundaries, result shapes, error normalization, and permission metadata.

## Boundaries

Do not decide approvals, assemble prompts, call model providers, or render CLI prompts in this package.

# Testing Strategy

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [testing-strategy.zh-CN.md](./testing-strategy.zh-CN.md)

## 1. Purpose

Testing is part of the ArvinClaw architecture, not a cleanup task after implementation.

ArvinClaw is both a usable agent product and a learning project. Tests should protect behavior, explain module boundaries, and make future refactors safer.

Core rule:

Every module and every iteration should include tests that match its risk and responsibility.

## 2. Why This Module Exists

General agents are risky because they connect model output to real actions.

The highest-risk areas are:

- Tool execution
- File writes
- Shell commands
- Permission decisions
- Prompt assembly
- Model tool-call parsing
- Configuration and secrets
- Session and trace persistence
- Memory writes

Tests should make these boundaries explicit.

## 3. Test Layers

ArvinClaw should use layered tests.

| Layer | Purpose | Examples |
| --- | --- | --- |
| Unit tests | Validate isolated behavior | Config merging, permission classification, redaction |
| Contract tests | Validate module interfaces | Tool result shape, model output normalization |
| Integration tests | Validate cross-module behavior | Agent loop with fake model and fake tools |
| CLI adapter tests | Validate user-visible workflows | `arvinclaw chat`, permission prompt flow, slash commands |
| Golden trace tests | Validate explainable trace shape | Stable trace event sequences for known runs |
| Safety regression tests | Prevent unsafe behavior from returning | Secret reads, destructive commands, prompt injection cases |

The MVP should start with unit, integration, CLI, and safety regression tests. Golden trace tests can be introduced once trace event shape stabilizes.

## 4. Test Doubles

Tests should avoid depending on real LLM calls.

Recommended test doubles:

- Fake model provider with scripted outputs
- Fake tool registry
- Fake tool implementations
- Fake permission adapter responses
- Temporary workspace directory
- In-memory session store
- In-memory trace sink

Real provider tests should be optional and separated from the normal test suite.

## 5. Module Expectations

Each module should have a minimum test expectation.

| Module | Required Test Focus |
| --- | --- |
| `packages/config` | Precedence, validation, redaction, secret presence |
| `packages/context` | Source ordering, truncation, redaction, prompt assembly reports |
| `packages/models` | Provider normalization, tool-call parsing, error normalization |
| `packages/core` | Loop state, stop conditions, fake model/tool integration |
| `packages/tools` | Input validation, result shape, workspace boundaries |
| `packages/permissions` | Risk classification, autonomy mode behavior, blocked actions |
| `packages/skills` | Discovery, precedence, malformed skill handling |
| `packages/sessions` | Session records, trace persistence, ordering |
| `apps/cli` | Command parsing, chat startup, approval prompts, trace rendering |

The implementation plan can refine exact test files, but these areas should not be skipped.

## 6. Safety Tests

Safety tests are required for any feature that can affect files, commands, secrets, memory, or remote content.

Required safety cases:

- Secret-like files are blocked or redacted.
- Shell commands require confirmation by default.
- Unknown tools are rejected.
- Invalid tool inputs are rejected before execution.
- Workspace paths are normalized.
- Paths outside the workspace are higher risk.
- Prompt files cannot override permission policy.
- Skills cannot grant themselves permissions.
- Trace and config output do not reveal raw secrets.

These tests should be treated as regression tests once added.

## 7. Trace Tests

Trace is both product UX and learning surface.

Trace tests should validate:

- Event type
- Event order
- Run ID association
- Tool call ID association
- Permission decision visibility
- Error visibility
- Redaction behavior
- Debug details hidden by default

Trace tests should avoid depending on exact prose unless the prose is part of user-facing contract.

## 8. CLI Tests

CLI tests should focus on adapter behavior, not agent intelligence.

Required areas:

- Help and version commands
- `chat` startup
- Slash command routing
- Permission prompt rendering
- Approval and denial forwarding
- Trace rendering from structured events
- Config display with redaction
- Recoverable startup errors

The CLI must not be tested by calling real providers in the normal suite.

## 9. Documentation Tests

Documentation can be tested where practical.

Useful checks:

- Bilingual heading count alignment
- No broken Markdown links
- No unfinished markers in committed design docs
- Roadmap references match existing or explicitly planned docs
- Example config snippets parse as JSON when feasible

These checks should start lightweight and become automated as the project grows.

## 10. Test Data Rules

Test data should avoid real secrets, personal data, or production credentials.

Use obvious fake values:

- `test-api-key`
- `sk-test-redacted`
- `example-model`
- `https://api.example.com/v1`

Tests should include secret-like fake values to verify redaction, but never real credentials.

## 11. CI Direction

Early CI can be simple:

```text
typecheck
unit tests
integration tests
lint or format check
documentation checks
```

Provider-dependent tests should be opt-in and not block normal CI.

## 12. Acceptance Criteria

The testing strategy is successful when:

- Every implemented module has a clear test layer.
- Safety-sensitive behavior has regression tests.
- CLI workflows are tested without real model calls.
- Config and trace redaction are tested.
- Documentation checks protect bilingual structure and links.
- Future phase plans include explicit test work.

## 13. Related Documents

- [Main design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Project Structure](./project-structure.md)
- [Runtime Composition](./runtime-composition.md)
- [Architecture Contracts](./contracts.md)
- [Configuration System](./configuration-system.md)
- [Permission System](./permission-system.md)
- [Execution Trace](./execution-trace.md)

# Development Workflow

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [dev-workflow.zh-CN.md](./dev-workflow.zh-CN.md)

## 1. Purpose

This document defines how Vole development work should be planned, implemented, tested, documented, and committed.

Vole is a product and a learning project. The workflow should make progress steady without hiding decisions, risks, or test gaps.

Core rule:

Every meaningful change should be understandable, tested according to risk, documented when it changes architecture or behavior, and committed at a readable size.

## 2. Work Modes

Vole work should move through these modes:

1. Discussion and design.
2. Design documentation.
3. Phase plan.
4. Implementation.
5. Verification.
6. Commit.
7. Review and next-step decision.

Implementation should not begin for a phase until the relevant phase plan exists and has been reviewed.

## 3. Documentation Before Code

When a change introduces or changes an architecture boundary, the design should be documented before or alongside the implementation.

Documentation is required for:

- New packages
- New runtime contracts
- Tool or permission behavior
- Prompt/context behavior
- Session, trace, memory, or persistence behavior
- User-visible CLI behavior
- Security-sensitive behavior

Small internal refactors may only need commit notes and tests.

## 4. Test Expectations

Each implementation step should add or update tests appropriate to its risk.

Minimum expectation:

- Pure logic: unit tests.
- Cross-package behavior: integration tests.
- CLI behavior: adapter tests.
- Tool execution or permissions: safety regression tests.
- Trace shape: trace tests or golden trace checks when stable.
- Documentation structure: bilingual and link checks when docs change.

No normal test should require a real API key or real model call.

## 5. Verification Before Completion

Before claiming a task is complete, run the relevant verification commands.

Expected verification areas:

- Typecheck
- Unit tests
- Integration tests
- CLI smoke checks when CLI behavior changes
- Documentation link checks when docs change
- Bilingual heading checks when docs change

If a verification command cannot be run, record why.

## 6. Commit Policy

Commits should be small, readable, and easy to revert.

Good commit properties:

- One coherent purpose.
- Clear subject line.
- Includes related tests or docs when practical.
- Does not mix unrelated refactors with feature work.
- Does not bundle multiple phases together.

Examples:

- `docs: define cli adapter experience`
- `feat(config): load project config`
- `test(permissions): cover blocked secret paths`
- `fix(cli): render provider startup errors`

Avoid large catch-all commits such as:

- `misc changes`
- `update docs`
- `wip`
- `big refactor`

## 7. Commit Boundaries

Recommended commit boundaries:

- One architecture document or closely related document group.
- One package skeleton.
- One tested behavior.
- One bug fix and its regression test.
- One roadmap or reference cleanup.

When a change touches code and docs, keep them together if the docs explain that exact behavior. Split them if the documentation is a broad design update.

## 8. Branch Policy

Default branch work can continue while the project is still small, but feature branches should be used once implementation begins to touch multiple packages or risky behavior.

Preferred branch prefix:

```text
codex/
```

Examples:

- `codex/phase-0-foundation`
- `codex/mvp-agent-loop`
- `codex/tools-permissions`

## 9. User Review Gates

Ask for user confirmation before:

- Starting a new phase implementation.
- Changing major architecture direction.
- Adding risky tool behavior.
- Changing memory or identity files.
- Changing commit or documentation policy.
- Moving or deleting large documentation sections.

Routine documentation updates within an approved plan can proceed, but should still be summarized.

## 10. Handling Dirty Worktrees

Before starting work, inspect the current worktree.

Rules:

- Do not revert user changes unless explicitly asked.
- If unrelated changes exist, avoid touching them.
- If related changes exist, inspect them and work with them.
- If existing changes make the task ambiguous, ask before proceeding.

## 11. Documentation Language Workflow

When editing an important document:

- Update English and Simplified Chinese versions in the same pass.
- Keep headings structurally aligned.
- Keep tables, examples, diagrams, testing requirements, and acceptance criteria aligned.
- Run a bilingual heading check.
- Run a Markdown link check when links change.

The translation should be complete, not a summary.

## 12. Risk-Based Autonomy

Low-risk documentation cleanup can be done directly once the user approves the direction.

Higher-risk implementation work should be planned and verified more carefully, especially when it touches:

- Shell execution
- File writes
- Secrets
- Permissions
- Memory
- Background automation
- Remote services

## 13. Acceptance Criteria

The development workflow is successful when:

- Work starts from an approved design or phase plan.
- Commits are small and readable.
- Tests are added according to risk.
- Verification happens before completion claims.
- Documentation stays bilingual and linked.
- The user can understand what changed and why.

## 14. Related Documents

- [Documentation System](./documentation-system.md)
- [Testing Strategy](./testing-strategy.md)
- [Architecture Contracts](./contracts.md)
- [Runtime Composition](./runtime-composition.md)
- [Phase 0 Foundation Plan](../plans/phase-0-foundation.md)
- [Phase 1 MVP Agent Loop Plan](../plans/phase-1-mvp-agent-loop.md)

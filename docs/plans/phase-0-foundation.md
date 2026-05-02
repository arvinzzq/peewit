# Phase 0 Foundation Plan

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [phase-0-foundation.zh-CN.md](./phase-0-foundation.zh-CN.md)

## 1. Purpose

Phase 0 creates the project foundation before the first working agent loop.

The goal is not to build a full agent yet. The goal is to create a TypeScript workspace, package boundaries, CLI shell, configuration foundation, documentation structure, and test harness that make Phase 1 straightforward.

## 2. User Result

After Phase 0, the user should be able to:

- Inspect the repository structure.
- Run basic project checks.
- Run the CLI help command.
- See where configuration will live.
- Read the roadmap and architecture docs.

## 3. Scope

Phase 0 includes:

- Lightweight TypeScript workspace setup.
- `apps/cli` package shell.
- Core package directories.
- `packages/config` initial loader shape.
- Test runner setup.
- Documentation index and roadmap cleanup.
- Root README.

Phase 0 does not include:

- Real model calls.
- Full agent loop.
- Tool execution.
- Long-term memory.
- Web UI.

## 4. Planned Work

Recommended order:

1. Create package and app directories.
2. Add workspace package configuration.
3. Add TypeScript configuration.
4. Add test runner configuration.
5. Add minimal CLI entry with `--help` and `--version`.
6. Add config package skeleton with defaults and redacted view.
7. Add root README.
8. Add documentation checks for bilingual headings and links where practical.

Each step should be committed separately when it creates a coherent result.

## 5. Proposed Directory Result

```text
apps/
  cli/
packages/
  config/
  core/
  context/
  models/
  tools/
  permissions/
  skills/
  sessions/
docs/
  architecture/
  decisions/
  plans/
  research/
  roadmap/
  superpowers/specs/
skills/
```

## 6. Package Boundaries

Phase 0 should create boundaries, not full behavior.

Expected initial packages:

- `apps/cli`: command entry and terminal adapter shell.
- `packages/config`: configuration defaults, loading shape, redacted output.
- `packages/core`: minimal runtime package boundary.
- `packages/context`: minimal context package boundary.
- `packages/models`: minimal provider package boundary.
- `packages/tools`: minimal tool package boundary.
- `packages/permissions`: minimal permission package boundary.
- `packages/skills`: minimal skill package boundary.
- `packages/sessions`: minimal session package boundary.

Minimal packages should include exports only when useful for tests.

## 7. CLI Shell

Phase 0 CLI behavior:

- `arvinclaw --help` shows available commands.
- `arvinclaw --version` shows package version.
- `arvinclaw chat` may print a friendly not-yet-implemented message or start a stub shell if Phase 1 is not started.

The CLI shell must not contain prompt assembly, model calls, tool execution, or permission decisions.

## 8. Configuration Foundation

Phase 0 config work should support:

- Built-in defaults.
- User config path concept.
- Project config path concept.
- Environment override concept.
- Redacted config view.
- Clear validation errors for obviously invalid values.

It does not need every future config field.

## 9. Tests

Required Phase 0 tests:

- CLI help renders successfully.
- CLI version renders successfully.
- Config defaults load.
- Config redaction hides secret-like values.
- Invalid config shape produces a useful error.
- Package boundaries do not import from `apps/cli`.
- Documentation bilingual heading check passes.

No test should call a real LLM provider in Phase 0.

## 10. Verification Commands

The exact commands depend on the chosen tooling, but Phase 0 should end with equivalents of:

```text
install dependencies
typecheck
run tests
run documentation checks
run CLI help
```

The final implementation commit should record which commands passed.

## 11. Commit Plan

Suggested fine-grained commits:

1. `chore: initialize typescript workspace`
2. `chore: add package boundaries`
3. `feat(cli): add command shell`
4. `feat(config): add initial config loader`
5. `test: add foundation checks`
6. `docs: add root project readme`

The exact commit messages can change, but each commit should remain easy to review and revert.

## 12. Acceptance Criteria

Phase 0 is complete when:

- The agreed directory structure exists.
- The project can install dependencies.
- TypeScript configuration is present.
- Test runner is configured.
- CLI help and version commands work.
- Config package has a tested initial shape.
- Documentation index and roadmap are consistent.
- No implementation depends on a real model call.

## 13. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Project Structure](../architecture/project-structure.md)
- [Configuration System](../architecture/configuration-system.md)
- [Runtime Composition](../architecture/runtime-composition.md)
- [Testing Strategy](../architecture/testing-strategy.md)
- [Architecture Contracts](../architecture/contracts.md)

# 0004: Documentation Maintenance Policy

Status: Accepted
Date: 2026-05-03

Simplified Chinese version: [0004-documentation-maintenance-policy.zh-CN.md](./0004-documentation-maintenance-policy.zh-CN.md)

## 1. Context

ArvinClaw is both a usable product and a learning project for understanding OpenClaw-like agent architecture.

That makes documentation part of the implementation, not a separate afterthought. A reader should be able to open a module, understand what role it plays in the agent system, and know which files matter before reading every line of code.

At the same time, documentation rules can become too heavy. If every small edit forces large duplicated comments and global documentation updates, the project will collect stale text and noisy commits.

## 2. Decision

ArvinClaw will use a lightweight file-explanation policy:

1. Every architecture module directory must have local README and AGENTS guides.
2. Every important project document must keep English and Simplified Chinese versions aligned.
3. Core source entry files must include a short file header explaining input, output, and system position.
4. Test files should explain the behavior they protect through clear test names or a short header when needed.
5. Config files, package manifests, generated files, build outputs, and lockfiles are explained through directory inventories, not source headers.

The goal is to make the project easier to learn and maintain without turning documentation into ceremony.

## 3. Directory Documentation

The following module directories require local guides:

- `apps/cli`
- `packages/config`
- `packages/context`
- `packages/core`
- `packages/models`
- `packages/permissions`
- `packages/sessions`
- `packages/skills`
- `packages/tools`
- `scripts`
- `tests`

Each module directory should include:

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- `AGENTS.zh-CN.md`

Each README should include:

- A three-line architecture summary
- A file inventory with file name, role, and purpose
- An update reminder

Each AGENTS guide should include:

- Module responsibility
- What to update when files change
- Testing expectations
- Boundaries that must not be crossed

Subdirectories do not need their own README and AGENTS files unless they become independent architecture boundaries.

## 4. Source File Headers

Core source entry files should include a short header:

```ts
/**
 * INPUT: Main imports, external APIs, environment variables, or injected dependencies.
 * OUTPUT: Main exports, side effects, or public API surface.
 * POS: The file's position in the ArvinClaw architecture.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
```

This rule applies first to:

- `apps/cli/src/index.ts`
- `packages/config/src/index.ts`
- `packages/context/src/index.ts`
- `packages/core/src/index.ts`
- `packages/models/src/index.ts`
- `packages/permissions/src/index.ts`
- `packages/sessions/src/index.ts`
- `packages/skills/src/index.ts`
- `packages/tools/src/index.ts`
- `scripts/check-docs.ts`

Generated files, `dist` outputs, lockfiles, `package.json`, `tsconfig.json`, and `.tsbuildinfo` files do not need source headers.

## 5. Update Triggers

When module responsibility changes:

- Update the source header.
- Update the module README file inventory.
- Update the module AGENTS guide.
- Update related architecture documents when the design changes.
- Add or update tests that protect the new behavior.

When implementation changes but responsibility does not change:

- Update tests if behavior changed.
- Update source headers only if dependencies, outputs, or system position changed.
- Leave global docs alone unless the change affects project-wide workflow or architecture.

When project workflow changes:

- Update root README files.
- Update root AGENTS files if agent instructions change.
- Update development workflow or decision documents when relevant.

## 6. Automated Checks

Documentation checks should enforce the lightweight policy:

- Required module directories have README and AGENTS guides.
- Required bilingual pairs exist.
- Required source entry files have `INPUT`, `OUTPUT`, and `POS` header markers.
- Markdown links remain valid.
- English and Simplified Chinese docs keep aligned heading counts.

Checks should ignore:

- `node_modules`
- `dist`
- coverage output
- `.tsbuildinfo`
- lockfiles
- generated files

## 7. Consequences

Positive:

- New contributors and future readers can understand each module quickly.
- The project remains useful as a learning artifact.
- Architecture boundaries become visible in both code and docs.
- Automated checks reduce drift.

Trade-offs:

- Each new architecture module needs small documentation work.
- Source headers must be kept honest when responsibilities change.
- Some commits will include documentation updates alongside code changes.

The policy is intentionally lighter than requiring long comments in every file.

## 8. Related Documents

- [Documentation System](../architecture/documentation-system.md)
- [Development Workflow](../architecture/dev-workflow.md)
- [Testing Strategy](../architecture/testing-strategy.md)
- [Project Structure](../architecture/project-structure.md)

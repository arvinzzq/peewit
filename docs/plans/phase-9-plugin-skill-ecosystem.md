# Phase 9: Plugin and Skill Ecosystem

Status: Complete
Date: 2026-05-05

Simplified Chinese version: [phase-9-plugin-skill-ecosystem.zh-CN.md](./phase-9-plugin-skill-ecosystem.zh-CN.md)

## 1. Overview

Phase 9 extends the skill system from a read-only loader into a managed ecosystem where the user can install, enable, disable, and review skills with full visibility into metadata, permissions, and trust status.

This phase is docs-first: design documents are committed before implementation begins.

## 2. Commit Sequence

| Part | Commit | Contents |
| --- | --- | --- |
| A | `docs: add Phase 9 design — plugin and skill ecosystem` (3ba04a5) | This plan, plugin-system.md, skill-permissions.md, roadmap update |
| B | `feat(skills): add extended metadata, SkillManager install/enable/disable/trust` (305c7fd) | packages/skills update with SkillManager, extended SkillDefinition, tests, docs |
| C | `feat(cli): add skills install, enable, disable, trust, review subcommands` (5f68eac) | apps/cli skills subcommands, tests, docs |
| D | `docs: mark Phase 9 complete` | Roadmap and plan status update |

## 3. Part A — Design Documents

Create bilingual design documents:

- `docs/plans/phase-9-plugin-skill-ecosystem.md` + zh-CN (this file)
- `docs/architecture/plugin-system.md` + zh-CN
- `docs/architecture/skill-permissions.md` + zh-CN

Update roadmap: Phase 9 → In Progress.

## 4. Part B — Extended Skill Metadata

Extend `packages/skills/src/index.ts`:

1. Add optional fields to `SkillDefinition`: `version`, `origin`, `permissions`, `trusted`, `enabled`, `filePath`.
2. Update `parseSKILLMd()` to parse new frontmatter fields.
3. Update `SkillLoader.load()` to skip disabled skills and mark untrusted user skills.
4. Add `SkillManifestEntry`, `SkillManifest` types.
5. Add `SkillManager` class with `install`, `enable`, `disable`, `trust`, `review`, `listEntries`.

Update tests, README, AGENTS docs, and source header.

## 5. Part C — CLI Skill Subcommands

Add to `apps/cli/src/index.ts`:

- `arvinclaw skills` — list all skills with version, trust status, permissions
- `arvinclaw skills install <path>` — install from local .md file
- `arvinclaw skills enable <name>` — enable a disabled skill
- `arvinclaw skills disable <name>` — disable an enabled skill
- `arvinclaw skills trust <name>` — mark as trusted
- `arvinclaw skills review <name>` — show full metadata

All subcommands use `SkillManager` from `@arvinclaw/skills`.
User skills directory is derived as sibling of sessions directory.

## 6. Part D — Mark Complete

Update plan and roadmap to Complete with commit hashes.

## 7. Acceptance Criteria

- Installed skills can be listed and disabled.
- Permission declarations are visible before use.
- Third-party skills cannot silently gain tool permissions.
- Version and source metadata are recorded.
- `arvinclaw skills trust <name>` marks a skill as trusted.
- Untrusted user skills display a warning in all listing commands.

## 8. Non-Goals

- No public marketplace operation.
- No automatic trust of third-party skills.
- No remote installation from URLs.
- No skill signature verification.
- No sandbox isolation of skill text.

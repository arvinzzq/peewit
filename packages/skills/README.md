# Skills Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/skills` owns **skill discovery, parsing, and lifecycle management**. Skills are reusable agent instruction files (`.md` with YAML frontmatter) that the agent can load on demand. The package provides a `SkillLoader` for discovery, a `SkillManager` for user-facing lifecycle operations (install, enable, disable, trust), and a `parseSKILLMd` parser for SKILL.md files.

```
Skill sources (3 tiers, precedence order):
  1. workspace/skills/*/SKILL.md    ← project-specific overrides
  2. ~/.vole/skills/*/SKILL.md      ← user-installed skills (manifest-gated)
  3. built-in (hardcoded)            ← research, project-inspector, safe-shell

        SkillLoader.load()
              │
              ▼
    SkillDefinition[]   →  toSkillSummary()  →  ContextSkillSummary[]
    (full, for CLI)         (compact, for context injection)
```

## Core Concepts

### SKILL.md Format

A skill file is a Markdown file with YAML frontmatter:

```markdown
---
name: my-skill
description: Short description used as context injection trigger.
version: 1.0.0
origin: https://example.com/skills/my-skill.md
permissions: read_file, list_directory
---

Full skill instructions go here. This body is loaded by the `load_skill` tool
when the agent needs to follow the skill's guidance in detail.
```

Required fields: `name`, `description`. Optional: `version`, `origin`, `permissions` (comma-separated or YAML array).

### SkillDefinition vs. SkillSummary

`SkillDefinition` carries the full skill metadata including `body`, `filePath`, `trusted`, `enabled`, `version`, `origin`, and `permissions`. It is used by the CLI (`vole skill list`, `vole skill review`).

`SkillSummary` is a compact projection (`name`, `description`, `source`) injected into the `<skills>` section of the context prompt. The agent sees only the skill name and description — it loads the full body on demand via the `load_skill` tool.

### Skill Sources and Precedence

`SkillLoader.load()` applies a first-seen-wins deduplication strategy:

1. **Workspace skills** (`{workspaceRoot}/skills/*/SKILL.md`) — highest precedence. Each subdirectory is one skill; additional files (templates, examples) can live alongside `SKILL.md`.
2. **User skills** (`~/.vole/skills/*/SKILL.md`) — same subdirectory layout as workspace skills, tracked via `skills-index.json` manifest. Skills not in the manifest, or with `enabled: false`, are skipped. `SkillManager.install()` creates the subdirectory and copies the source file as `SKILL.md`.
3. **Built-in skills** — hardcoded in source: `research`, `project-inspector`, `safe-shell`.

If a workspace skill and a user skill share the same `name`, the workspace skill wins (its entry is added first to the `seen` set).

### SkillManifest

```typescript
interface SkillManifest {
  skills: SkillManifestEntry[];
}

interface SkillManifestEntry {
  name: string;
  filePath: string;
  installedAt: string;
  origin?: string;
  trusted: boolean;   // true = trusted third-party skill
  enabled: boolean;   // false = skip during loading
}
```

The manifest file lives at `~/.vole/skills/skills-index.json`. It is read by `SkillLoader` to filter user skills, and written by `SkillManager` when lifecycle operations are performed.

### Built-in Skills

Three built-in skills are always available, always trusted, and cannot be disabled:

| Name | Purpose |
|---|---|
| `research` | Web search, source comparison, citation-aware output |
| `project-inspector` | Codebase structure inspection and module summarization |
| `safe-shell` | Shell command risk assessment and safer execution guidance |

Built-in skills have empty `filePath` strings (they are hardcoded, not files).

## Implementation Principles

### SkillLoader: Error Tolerance

All file system errors during skill loading are silently caught and skipped. A missing `skills/` directory, a malformed SKILL.md, or an unreadable file does not fail the load — the skill is simply absent from the result. This prevents a single broken skill file from crashing the agent startup.

### parseSKILLMd: YAML Subset Parser

The parser implements a minimal YAML subset without a YAML library dependency:

1. Finds the `---` opening and closing delimiters.
2. Parses `key: value` lines, building a flat `fields` record.
3. Handles YAML list syntax (`  - item`) for array fields like `permissions`.
4. Supports comma-separated `permissions: a, b, c` as an alternative.
5. Returns `null` if `name` or `description` fields are missing.

The parser is intentionally limited to what SKILL.md files need. Full YAML parsing would add complexity without benefit.

### SkillManager: Lifecycle Operations

`SkillManager` wraps the manifest file with a load-modify-save pattern:

- `install(sourcePath)` — creates `<name>/` subdirectory, copies the source file as `SKILL.md`, upserts the manifest entry with `trusted: false, enabled: true`.
- `enable(name)` / `disable(name)` — loads manifest, finds entry by name, sets `enabled`, saves manifest.
- `trust(name)` — loads manifest, finds entry, sets `trusted: true`, saves manifest.
- `review(name)` — loads the skill file and returns the full `SkillDefinition` for inspection before trusting.

All operations throw if the skill name is not found in the manifest.

### Injectable File System Operations

Both `SkillLoader` and `SkillManager` accept injectable `readDir` and `readFile` functions (in `SkillLoaderOptions`). This allows tests to provide in-memory file systems without touching the real filesystem.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the skills package and exports (no workspace package dependencies). |
| `tsconfig.json` | TypeScript config | Builds the skills package. |
| `src/index.ts` | Skill system | All exports: `SkillDefinition`, `SkillSummary`, `SkillManifest`, `SkillManifestEntry`, `SkillSource`, `SkillLoader`, `SkillManager`, `parseSKILLMd`, `toSkillSummary`. |
| `src/index.test.ts` | Skill tests | Protects SKILL.md parsing, precedence loading, manifest filtering, SkillManager lifecycle, error tolerance, and summary projection. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

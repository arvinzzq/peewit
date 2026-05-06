# Plugin System

Simplified Chinese version: [plugin-system.zh-CN.md](./plugin-system.zh-CN.md)

## 1. Purpose

The plugin system gives users a managed way to install, enable, disable, and inspect skills that are not bundled with Peewit. It records provenance, version, and trust status so that users always know where a skill came from and whether they have reviewed it.

## 2. Scope

Phase 9 covers local file installation only. Remote URL installation, signature verification, and a public marketplace are non-goals for this phase.

## 3. Plugin Metadata Format

Each installed skill is a Markdown file (`*.md`) with YAML frontmatter. The frontmatter supports these fields:

```yaml
---
name: my-skill
description: What this skill does and when to invoke it.
version: 1.0.0
origin: /path/to/source.md
permissions: filesystem, shell
---
Skill body text injected into the system prompt.
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Unique identifier for the skill. |
| `description` | Yes | Human-readable purpose and invocation hint. |
| `version` | No | Semver or free-form version string. |
| `origin` | No | URL or local path the skill was installed from. |
| `permissions` | No | Comma-separated list or YAML array of declared capability claims. |

## 4. Installation Path

Skills installed by the user live at:

```
~/.peewit/skills/<name>.md
```

This is the sibling directory of the sessions directory (`~/.peewit/sessions/`).

Workspace skills live at `<workspaceRoot>/skills/<name>/SKILL.md` and are always trusted. Built-in skills are embedded in the `@peewit/skills` package binary.

## 5. Manifest File

The manifest tracks installed user skills and their lifecycle state:

```
~/.peewit/skills/skills-index.json
```

Example content:

```json
{
  "skills": [
    {
      "name": "my-skill",
      "filePath": "/Users/arvin/.peewit/skills/my-skill.md",
      "installedAt": "2026-05-05T10:00:00.000Z",
      "origin": "/path/to/source.md",
      "trusted": false,
      "enabled": true
    }
  ]
}
```

The manifest is the source of truth for `enabled` and `trusted` state. When the manifest is missing, `SkillLoader` proceeds without it (no installed skills).

## 6. Trust Model

Skills are plain text injected into the system prompt. They cannot execute code directly but a malicious skill body could attempt prompt injection — instructing the model to call dangerous tools or reveal sensitive context.

The trust model provides visibility and control:

- **Workspace skills** are always trusted (checked into the project repository).
- **Built-in skills** are always trusted (shipped with the package).
- **User-installed skills** start as `trusted: false`.
- A skill with `trusted: false` is still loaded (for usability) but the CLI displays a prominent warning.
- The user explicitly trusts a skill with `peewit skills trust <name>`.

The `trusted` flag does not grant extra capabilities; it only suppresses the warning.

## 7. Lifecycle

```
install → (trusted: false, enabled: true)
  ↓
review (peewit skills review <name>)
  ↓
trust (peewit skills trust <name>) → trusted: true
  ↓
disable (peewit skills disable <name>) → enabled: false
  ↓
enable (peewit skills enable <name>) → enabled: true
```

## 8. SkillManager API

```ts
class SkillManager {
  constructor(skillsDirectory: string)

  async loadManifest(): Promise<SkillManifest>
  async saveManifest(manifest: SkillManifest): Promise<void>

  async install(sourcePath: string): Promise<SkillManifestEntry>
  async enable(name: string): Promise<void>
  async disable(name: string): Promise<void>
  async trust(name: string): Promise<void>
  async review(name: string): Promise<SkillDefinition | undefined>

  async listEntries(): Promise<SkillManifestEntry[]>
}
```

`install` copies the `.md` file to `{skillsDirectory}/{name}.md` and adds a manifest entry. If a skill with the same name already exists, the file is overwritten and `installedAt` is updated.

## 9. Precedence Rules

Loading order (highest to lowest precedence):

1. Workspace skills (`<root>/skills/<name>/SKILL.md`)
2. User-installed skills (`~/.peewit/skills/<name>.md`)
3. Built-in skills

Disabled user skills are skipped entirely. If a user skill has the same name as a built-in skill, the user skill takes precedence (subject to the disabled check).

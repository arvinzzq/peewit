# Skill Permissions

Simplified Chinese version: [skill-permissions.zh-CN.md](./skill-permissions.zh-CN.md)

## 1. Purpose

Skill permissions give authors a way to declare what system capabilities a skill requires. Users can read these declarations before trusting a skill. Declarations are advisory — they do not automatically grant or deny tool access — but they make the surface area of a skill visible.

## 2. Permission Declaration Fields

Permissions are declared in skill frontmatter as a comma-separated string or YAML array:

```yaml
# Comma-separated form
permissions: filesystem, shell

# YAML array form
permissions:
  - filesystem
  - shell
```

Recognized permission values:

| Value | Meaning |
| --- | --- |
| `filesystem` | Skill may instruct the model to read or write files. |
| `shell` | Skill may instruct the model to run shell commands. |
| `web` | Skill may instruct the model to read web pages. |
| `memory` | Skill may instruct the model to write to long-term memory files. |

Unknown values are stored as-is and displayed to the user. They do not block loading.

## 3. Trust Review Flow

When a user installs a skill, the CLI workflow is:

1. `vole skills install <path>` — copies file, records `trusted: false`.
2. `vole skills review <name>` — shows full metadata including declared permissions.
3. User reads the permissions and skill body.
4. `vole skills trust <name>` — records `trusted: true` in the manifest.

Until the skill is trusted, every listing command shows a warning:

```
⚠ untrusted  my-skill  [filesystem, shell]
This skill was installed from an external source and has not been trusted.
Run `vole skills trust my-skill` to trust it.
```

## 4. Why Skill Text Is the Security Surface

Skills are plain text injected verbatim into the system prompt before the user's message. The model reads the skill body as instruction. A malicious body could:

- Ask the model to call `shell` tools with specific commands.
- Ask the model to read or exfiltrate files.
- Override safety instructions with conflicting directives.

The trust flag communicates "I have read this skill and consider it safe." It does not enforce isolation or sandbox the text. The actual tool permission decisions still go through the `@vole/permissions` package regardless of skill trust.

## 5. CLI Review Commands

```
vole skills             List all skills — shows version, trust badge, permissions
vole skills install <path>
                             Install a skill from a local .md file
vole skills enable <name>
                             Enable a disabled skill
vole skills disable <name>
                             Disable an enabled skill
vole skills trust <name>
                             Mark an installed skill as trusted
vole skills review <name>
                             Show full skill metadata and permission declarations
```

The `review` subcommand output:

```
Name:         my-skill
Source:       user
Version:      1.0.0
Origin:       /path/to/source.md
Permissions:  filesystem, shell
Trusted:      false
Enabled:      true
Installed:    2026-05-05T10:00:00.000Z

--- Body ---
Skill body text here.
```

## 6. Design Constraints

- Permission declarations are stored in `SkillDefinition.permissions: string[]`.
- `parseSKILLMd` accepts both comma-separated and YAML array forms.
- The `trusted` flag in the manifest is the single source of truth for trust state.
- Workspace and built-in skills do not appear in the manifest and do not need a trust flag.

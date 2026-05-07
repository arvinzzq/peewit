# Module 09: @vole/skills

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `10-skills.zh-CN.md` (create alongside this file)

Related source: `packages/skills/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [07-context.md](./07-context.md) — the `<skills>` section in the system prompt
is built from `SkillSummary[]`, and this is where those summaries come from.

**Before reading**: Read `packages/skills/src/index.ts` in full. Notice there are two
distinct classes: `SkillLoader` (read-only discovery) and `SkillManager` (write-path
lifecycle management).

**Focus questions**:
- What is the difference between `SkillDefinition` and `SkillSummary`? Why does context
  assembly receive only `SkillSummary`?
- Three sources exist. If workspace and user both have a skill named `research`, which wins?
  Trace the exact code path.
- Why does `@vole/skills` have no external dependencies? What does `parseSKILLMd` do?
- `trusted` is a field on `SkillDefinition`, but `SkillLoader` does not enforce it.
  Who does?

**Checkpoint**: You understand this module when you can describe the full journey from a
`SKILL.md` file on disk to a one-line entry in the `<skills>` system prompt section, and
explain why the body is not included.

## 1. What This Module Does

**Plain language**: Think of skills as recipe cards in a drawer. The agent always has a
drawer index — a list of card names and one-line descriptions. When the agent decides it
needs to follow a recipe, it pulls out that card and reads the full instructions. The agent
never reads all the cards at once; it only pulls the one it needs. Skills work the same
way: the system prompt contains a compact index, and the full instructions are loaded
on demand.

**Technical summary**: `@vole/skills` discovers, parses, and manages reusable agent
instruction files (`SKILL.md`). It provides `SkillLoader` for reading skill files from
three sources (workspace, user, built-in), `SkillManager` for user-facing lifecycle
operations (install, enable, disable, trust), and `parseSKILLMd` for parsing SKILL.md
frontmatter. The package exposes `SkillSummary` for compact context injection and
`SkillDefinition` for full metadata access by the CLI.

## 2. Why It Exists

Without skills, agent behaviour can only be guided by the system instruction — a single
static text block. Skills add a second layer: reusable, composable instruction sets that
the agent can selectively apply to the task at hand.

Skills also solve a token budget problem. A workspace might have dozens of skills. If
every skill's full body were injected into every prompt, token costs would scale linearly
with the skill count regardless of whether any skill was relevant. The index-then-load
design bounds the per-turn cost to ~20 tokens per skill in the index, with full bodies
only appearing when explicitly triggered.

## 3. Public Interface

```ts
// A fully-parsed skill with all metadata
interface SkillDefinition {
  name: string
  description: string
  body: string           // full instructions — NOT injected into context by default
  source: SkillSource    // "built-in" | "user" | "workspace"
  filePath: string
  version?: string
  origin?: string        // URL where the skill was downloaded from
  permissions?: string[] // declared capabilities (e.g. ["filesystem", "shell"])
  trusted?: boolean      // user skills only: true after explicit trust
  enabled?: boolean      // user skills only: false = skip during loading
}

// Compact projection injected into <skills> context section
interface SkillSummary {
  name: string
  description: string
  source: SkillSource
}

// Discovery
class SkillLoader {
  load(options?: SkillLoaderOptions): Promise<SkillDefinition[]>
}

// Lifecycle management (user skills only)
class SkillManager {
  install(sourcePath: string): Promise<SkillManifestEntry>
  enable(name: string): Promise<void>
  disable(name: string): Promise<void>
  trust(name: string): Promise<void>
  review(name: string): Promise<SkillDefinition | undefined>
  listEntries(): Promise<SkillManifestEntry[]>
}

// Utility
function parseSKILLMd(content: string): { name, description, body, ... } | null
function toSkillSummary(skill: SkillDefinition): SkillSummary
```

## 4. Implementation Walkthrough

### SKILL.md format

Every skill is a Markdown file with YAML frontmatter:

```markdown
---
name: research
description: Use when investigating external information or comparing sources.
version: 1.0.0
origin: https://example.com/skills/research.md
permissions: filesystem
---

Search for relevant sources, read and compare at least two, and summarize
findings with source links. Prefer primary sources. Flag conflicting evidence.
```

`name` and `description` are required. Everything between the first `---` pair is
metadata; everything after is the `body`.

### Three-source loading with precedence

`SkillLoader.load()` loads from three sources in order, using a first-seen-wins `Set`:

```ts
const seen = new Set<string>();
const add = (skill) => {
  if (!seen.has(skill.name)) { seen.add(skill.name); skills.push(skill); }
};

// 1. Workspace — highest precedence
for (const skill of workspaceSkills) add(skill);

// 2. User — overrides built-in, but not workspace
for (const skill of userSkills) add(skill);

// 3. Built-in — lowest precedence
for (const skill of BUILTIN_SKILLS) add(skill);
```

A workspace `research` skill blocks both the user and built-in `research` from loading.
The agent only ever sees one skill per name.

### File structure: subdirectories for both sources

Both workspace and user skills use the same `<name>/SKILL.md` layout:

```
workspace:  ./skills/research/SKILL.md
user:       ~/.vole/skills/research/SKILL.md
```

This allows each skill to co-locate additional files (templates, examples) alongside
the definition. `SkillManager.install()` creates the subdirectory and copies the source
file as `SKILL.md`.

### User skill manifest

User skills have a `skills-index.json` manifest at `~/.vole/skills/skills-index.json`:

```json
{
  "skills": [
    {
      "name": "research",
      "filePath": "~/.vole/skills/research/SKILL.md",
      "installedAt": "2026-05-07T10:00:00Z",
      "origin": "https://example.com/skills/research.md",
      "trusted": false,
      "enabled": true
    }
  ]
}
```

`SkillLoader` reads this manifest to skip `enabled: false` skills. `SkillManager` writes
it when lifecycle operations are performed.

### From SkillDefinition to SkillSummary

At runtime, the CLI maps `SkillDefinition[]` to `SkillSummary[]` before passing to
`ContextAssembler`:

```ts
const skillIndex = skillDefinitions.map(toSkillSummary);
// toSkillSummary drops: body, filePath, trusted, enabled, version, origin, permissions
// keeps: name, description, source
```

The assembled `<skills>` section looks like:

```
<skills>
- research: Use when investigating external information or comparing sources.
- safe-shell: Use when planning to run shell commands, especially destructive ones.
</skills>
```

The model reads this index, decides if a skill is relevant, and calls `load_skill("research")`
to fetch the full body. Body injection happens only when triggered.

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Skill discovery from workspace + user + built-in | `SkillLoader.load()` | Same three-source model |
| Compact skill index in system prompt | `SkillSummary[]` → `<skills>` section | Same progressive disclosure |
| `load_skill` tool for on-demand body loading | `load_skill` tool in `@vole/tools` | Identical concept |
| Per-skill trust gating for third-party skills | `trusted` field + CLI enforcement | OpenClaw has richer permission model |
| Skill manifest for user lifecycle | `skills-index.json` | Same pattern |

## 6. Key Design Decisions

**Progressive disclosure: index first, body on demand**

The system prompt contains only `name` and `description` per skill (~20 tokens each).
The full body (potentially thousands of tokens per skill) is never in the initial context.
When the model calls `load_skill("research")`, the body is injected for that turn only.

Without this design, a workspace with 20 skills would add several thousand tokens to
every prompt regardless of relevance. Progressive disclosure keeps per-turn cost constant
regardless of skill count.

**First-seen-wins deduplication**

The three loading passes (workspace → user → built-in) use a single `seen` Set. The
first `add()` call for a given name wins; subsequent calls for the same name are silently
dropped. This is simpler than merge semantics (which would require deciding which fields
to prefer) and gives workspace skills unambiguous override power.

**`trusted` is metadata, not enforcement**

`SkillLoader` records `trusted: false` for newly installed user skills and exposes it
on `SkillDefinition`, but enforces nothing. The trust check lives in the CLI adapter —
it decides whether to prompt the user before running a skill with elevated permissions.
This separation keeps the skills package free of permission policy and reusable in
contexts with different trust models.

**No external dependencies and a hand-written parser**

`@vole/skills` has no workspace package dependencies and no third-party dependencies.
`parseSKILLMd` is a custom YAML-subset parser that handles the small set of constructs
SKILL.md files need: `key: value`, `  - item` arrays, and `---` delimiters. A full YAML
library would add security surface area and dependency weight with no practical benefit.

**`SkillLoader` vs `SkillManager` — read vs write paths**

`SkillLoader` is read-only: it discovers and parses skill files but never writes anything.
`SkillManager` owns the write path: it creates directories, copies files, and updates
the manifest. The two classes never share state. This separation means `SkillLoader`
can be called on every `runTurn` without risk of side effects.

## 7. Testing Approach

Tests are in `packages/skills/src/index.test.ts`. `SkillLoader` tests use injectable
`readDir` and `readFile` functions — no real filesystem needed. `SkillManager` tests
use real temporary directories.

Test categories:
- `parseSKILLMd`: valid frontmatter, missing delimiters, missing required fields,
  optional fields (version, origin, permissions comma-separated and YAML array)
- `SkillLoader`: built-in fallback, workspace loading, workspace overrides built-in,
  user skill loaded, workspace overrides user, missing directory graceful skip,
  unreadable file silently skipped, disabled skill skipped via manifest, untrusted default
- `SkillManager`: install creates subdirectory and manifest entry, install with extended
  fields, enable/disable sets manifest flag, trust sets trusted flag, review returns
  full definition, listEntries returns manifest, throws for unknown name

## 8. Insights

**The `<skills>` section is a routing table, not a knowledge base.** Each entry is a
trigger condition ("Use when...") that helps the model decide whether to load the skill.
A good description answers "when should I pull this card?" not "what does this skill do?"
This is why the CLAUDE.md skill authoring guide requires descriptions to include
use-when and skip-when conditions.

**Skills are composable without orchestration.** The model can load multiple skills in
sequence during a single turn by calling `load_skill` multiple times. There is no
orchestrator deciding which skills to combine — the model reads the index and makes that
decision itself based on the current task.

**Workspace skills are the primary customization point.** Built-in skills are universal
fallbacks; user skills are personal preferences; workspace skills are project-specific
overrides that ensure every team member's agent follows the same project conventions.
A workspace `research` skill that says "always check our internal wiki first" overrides
the generic built-in for every session in that workspace.

**`trusted` and `enabled` only apply to user skills — and that is intentional.**
Workspace skills are in version control: they are reviewed before merging, their history
is visible, and they can only be changed by someone with write access. Built-in skills
are part of the codebase. Only user-installed skills come from external sources and
require explicit trust. Applying trust gating to workspace or built-in skills would add
friction without addressing a real threat model.

## 9. Review Questions

1. What is the difference between `SkillDefinition` and `SkillSummary`? Why does
   `ContextAssembler` receive `SkillSummary[]` instead of `SkillDefinition[]`?
   > `SkillDefinition` contains the full skill including `body`, `filePath`, `trusted`,
   > `enabled`, `version`, `origin`, and `permissions`. `SkillSummary` is a compact
   > projection with only `name`, `description`, and `source`. `ContextAssembler` receives
   > `SkillSummary[]` because the body must not be in the initial context — it is loaded
   > on demand via `load_skill`. Injecting all bodies would add thousands of tokens per
   > prompt regardless of relevance.

2. Workspace and user skills both have a skill named `research`. Which one does the model
   see? Trace the code path.
   > The workspace version wins. `SkillLoader.load()` calls `add()` for workspace skills
   > first. `add()` adds `"research"` to the `seen` Set. When user skills are processed,
   > `add()` finds `"research"` already in `seen` and skips it. The model's `<skills>`
   > index contains the workspace description.

3. Why does `@vole/skills` have no external dependencies? What does `parseSKILLMd` handle?
   > No external dependencies keeps the package lightweight and free of security surface
   > area. `parseSKILLMd` implements a minimal YAML subset: `---` delimiters, `key: value`
   > lines, `  - item` array syntax, and `name`/`description` validation. Full YAML
   > parsing is unnecessary given what SKILL.md files actually contain.

4. `trusted: false` appears on a `SkillDefinition`. Does `SkillLoader` refuse to load it?
   > No. `SkillLoader` records the trust state from the manifest but does not enforce it.
   > A skill with `trusted: false` is loaded into `SkillDefinition[]` just like any other.
   > The CLI adapter is responsible for checking `trusted` before executing skill-guided
   > actions, and prompting the user if needed.

5. What is the difference between `SkillLoader` and `SkillManager`?
   > `SkillLoader` is read-only: it discovers skill files, parses them, and returns
   > `SkillDefinition[]`. It is called every turn. `SkillManager` is the write path: it
   > installs skills (creates subdirectory, copies SKILL.md), and manages the manifest
   > (enable, disable, trust). It is called by CLI skill management commands. The two
   > classes never interact.

6. Why do both workspace and user skills use `<name>/SKILL.md` subdirectory layout?
   > The subdirectory layout allows each skill to co-locate additional files (templates,
   > examples, reference data) alongside the definition. A flat single-file structure
   > would limit each installed skill to exactly one file. Using the same layout for both
   > sources also simplifies `#loadFromDir` — the loading logic is identical regardless
   > of source.

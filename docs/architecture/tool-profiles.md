# Tool Profiles

Status: Design
Date: 2026-05-11

Simplified Chinese version: [tool-profiles.zh-CN.md](./tool-profiles.zh-CN.md)

## 1. Purpose

Not every agent run needs every tool. A background summarization agent does not need shell execution. A messaging bot does not need file write access. Injecting all tools into every prompt wastes tokens and creates unnecessary attack surface.

Tool profiles define named capability sets that determine which tools are available for a given session or run. They are configured once and applied before the permission system evaluates individual tool calls.

The core rule:

Tool profiles reduce scope. They never grant permissions beyond what the permission policy allows. A tool excluded from a profile cannot be called regardless of permission level.

## 2. Profile Types

Vole defines four built-in profile types:

```typescript
type ToolProfile = "coding" | "full" | "messaging" | "background";
```

| Profile | Use Case |
| --- | --- |
| `coding` | Autonomous coding tasks: read/write files, run shell, run tests |
| `full` | General-purpose interactive sessions: all registered tools |
| `messaging` | Channel-based communication: read tools only, no shell, no file writes |
| `background` | Scheduled or background tasks: read-only subset, no interactive approvals |

## 3. Profile Definitions

| Tool | coding | full | messaging | background |
| --- | --- | --- | --- | --- |
| `read_file` | yes | yes | yes | yes |
| `list_directory` | yes | yes | yes | yes |
| `write_file` | yes | yes | no | no |
| `run_shell` | yes | yes | no | no |
| `read_web_page` | yes | yes | yes | yes |
| `web_search` | yes | yes | yes | yes |
| `append_daily_memory` | no | yes | no | yes |
| `update_todos` | yes | yes | no | no |
| `load_skill` | yes | yes | no | yes |
| `sessions_spawn` | no | yes | no | no |

Notes:

- `background` profile disables shell and file writes because background tasks should not trigger interactive approval prompts.
- `messaging` profile is read-only to prevent channel-based agents from making filesystem side effects.
- `coding` profile is the narrowest write-capable profile: it includes shell and file writes but not memory or sub-agent spawning.
- `full` profile includes all registered tools and is the default for interactive CLI sessions.

Custom profiles can be defined by adding entries to the profile registry. Custom profile names must not conflict with built-in names.

## 4. Profile Selection

Profile selection priority:

1. Explicit `profile` field in `RunOptions`
2. Default profile for the session's adapter type (CLI → `full`, background → `background`, messaging → `messaging`)
3. Global default in configuration: `tools.defaultProfile`

If no profile is specified anywhere, `full` is used.

```typescript
interface RunOptions {
  profile?: ToolProfile | string; // built-in or custom profile name
  // ...
}
```

The profile is resolved once at the start of `runTurn()` and applied to filter the tool registry before context assembly. This ensures that filtered tools never appear in the model's system prompt.

## 5. Interaction with Permissions

Tool profiles and the permission system are complementary layers:

- **Profile** controls which tools are visible and callable for the run.
- **Permission policy** controls whether a visible tool's action is allowed, requires confirmation, or is blocked.

A tool not in the active profile is invisible to the model: it does not appear in the system prompt, cannot be called, and is never evaluated by the permission system.

A tool in the profile is still subject to normal permission evaluation. Profile inclusion does not bypass risk classification or user approval.

Order of evaluation:

```
1. Profile filter → visible tool set
2. Permission policy → allowed / confirm / block per tool call
```

## 6. OpenClaw Alignment

OpenClaw defines capability sets per channel and per run type. Key alignments:

| OpenClaw concept | Vole equivalent |
| --- | --- |
| Per-channel tool set | `ToolProfile` per adapter type |
| Coding capability set | `"coding"` profile |
| Background capability set | `"background"` profile |
| Tool set applied before permission | Profile filter before permission evaluation |

OpenClaw's implementation confirms that profile-gating is simpler and safer than relying on permissions alone for scope reduction.

## 7. Acceptance Criteria

Tool profiles are considered complete when:

- Four built-in profiles are defined with the tool sets described in Section 3.
- `RunOptions.profile` selects the active profile for a run.
- Tools not in the active profile are excluded from the system prompt and cannot be called.
- Adapter-default profiles are assigned if no explicit profile is configured.
- The permission system is unaffected for tools that are in the active profile.
- Unit tests cover: profile filter application, adapter default assignment, custom profile registration.

## 8. Related Documents

- [Tool System](./tool-system.md)
- [Permission System](./permission-system.md)
- [Execution Contract](./execution-contract.md)
- [Background Automation](./background-automation.md)
- [Adapters](./adapters.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Roadmap](../roadmap/overview.md)

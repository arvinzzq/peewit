# Tools Package

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Architecture Overview

`@vole/tools` owns the **tool capability boundary**: it defines what tools exist, what their inputs look like, and how they execute. It does not decide whether a tool is allowed to run — that is the exclusive responsibility of `@vole/permissions`.

```
AgentRuntime
    │ uses
    ▼
ExecutableTool[]    ← @vole/tools
    │
    ├─ read_file        (low risk)
    ├─ list_directory   (low risk)
    ├─ write_file       (medium risk)  ← create new files or full replacement
    ├─ edit_file        (medium risk)  ← precise string replacement in existing files
    ├─ append_file      (medium risk)  ← add content at end of file
    ├─ run_shell        (high risk)
    ├─ read_web_page    (low risk)
    ├─ search_files     (low risk)
    ├─ update_todos     (low risk)
    ├─ append_daily_memory (medium risk)
    ├─ update_heartbeat (low risk)
    ├─ load_skill       (low risk)
    ├─ memory_search    (low risk)
    ├─ memory_get       (low risk)
    ├─ spawn_subagent   (medium risk, created in core)
    └─ spawn_subagent_async (medium risk, created in core)
```

## Core Concepts

### Tool Contracts

`ToolDefinition` carries static metadata:

```typescript
interface ToolDefinition {
  name: string;
  description: string;       // shown to the model in the system prompt
  inputSchema: ToolInputSchema;  // JSON schema for the model's input
  risk: ToolRiskLevel;       // "low" | "medium" | "high" | "blocked"
}
```

`ExecutableTool` extends `ToolDefinition` with an `execute` method:

```typescript
interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

`ToolExecutionContext` carries `workspaceRoot: string`, the only runtime dependency injected into tool execution.

### ToolExecutionResult

A discriminated union covering all possible outcomes:

| Result type | `ok` | Used by |
|---|---|---|
| `ReadFileToolResult` | `true` | `read_file` |
| `ListDirectoryToolResult` | `true` | `list_directory` |
| `WriteFileToolResult` | `true` | `write_file` |
| `ShellToolResult` | `true` | `run_shell` |
| `ReadWebPageToolResult` | `true` | `read_web_page` |
| `UpdateTodosResult` | `true` | `update_todos` |
| `AppendDailyMemoryResult` | `true` | `append_daily_memory` |
| `UpdateHeartbeatResult` | `true` | `update_heartbeat` |
| `LoadSkillResult` | `ok: boolean` | `load_skill` |
| `MemorySearchResult` | `true` | `memory_search` |
| `MemoryGetResult` | `true` | `memory_get` |
| `EditFileResult` | `true` | `edit_file` |
| `AppendFileResult` | `true` | `append_file` |
| `SearchFilesResult` | _(type field)_ | `search_files` |
| `SpawnSubagentResult` | `ok: boolean` | `spawn_subagent` (core) |
| `SpawnSubagentAsyncResult` | _(no ok)_ | `spawn_subagent_async` (core) |
| `ToolExecutionFailure` | `false` | any error path |

### InMemoryToolRegistry

A simple name-keyed `Map<string, ToolDefinition>`. All returned values are `structuredClone`d to prevent mutation of registry internals. `list()` returns tools sorted alphabetically by name for deterministic ordering.

## Built-in Tools

### Workspace Boundary (read_file, list_directory, write_file)

All path-based tools enforce a **workspace boundary**: the resolved absolute path must start with `resolve(workspaceRoot)`. If not, the tool returns `{ ok: false, error: { code: "path_outside_workspace" } }`.

`read_file` and `write_file` also block **secret-like paths** (`.env`, `.env.*`, `.netrc`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`) before any filesystem access.

### Shell Tool Safety Layers (run_shell)

Three layers of protection:

1. **Blocked command patterns** (`BLOCKED_COMMAND_PATTERNS`): Static regex patterns that block `rm -r*` targeting `/` or `~`, fork bombs (`:() {`), writes to block devices, and disk formatting tools (`mkfs`, `fdisk`, `parted`, `shred`).

2. **Sandbox escape patterns** (`SANDBOX_ESCAPE_PATTERNS`, only when `sandboxed: true`): Rejects `/../` path traversal, `cd /`, and `cd ~` — commands that would navigate outside the workspace directory.

3. **Output truncation**: stdout and stderr are capped at 4,000 characters each to prevent context window overflow.

The shell always runs with `cwd = context.workspaceRoot`. Default timeout is 30 seconds; callers can override via `{ timeoutMs }`.

### Web Tool (read_web_page)

Fetches the URL, strips `<script>`, `<style>`, and all HTML tags, decodes HTML entities, collapses whitespace, and truncates to 8,000 characters. Only `http:` and `https:` URLs are accepted. The `fetch` function is injectable for testing.

### Precise Editing Tools (edit_file, append_file)

`edit_file` replaces an exact string in an existing file — the model never accidentally destroys surrounding code. Inputs:

| Field | Type | Required | Default |
|---|---|---|---|
| `path` | `string` | yes | — |
| `old_string` | `string` | yes | — |
| `new_string` | `string` | yes | — |
| `replace_all` | `boolean` | no | `false` |

Returns `string_not_found` if `old_string` is absent; `multiple_matches` if it appears more than once and `replace_all` is false. Apply the same workspace-boundary and secret-path guards as `write_file`.

`append_file` adds content to the end of a file without touching existing content. Creates the file and parent directories if they do not exist.

**When to use which:**
- `edit_file` — modifying existing code, config, or test cases
- `append_file` — adding a new describe block, new entries, logs
- `write_file` — creating a new file or intentionally replacing everything

### Search Tool (search_files)

Recursively searches workspace files for a text or regex pattern. Inputs:

| Field | Type | Required | Default |
|---|---|---|---|
| `pattern` | `string` | yes | — |
| `path` | `string` | no | workspace root |
| `include` | `string` | no | all non-binary files |
| `case_sensitive` | `boolean` | no | `false` |
| `max_results` | `number` | no | `50` |

Automatically skips `node_modules`, `.git`, `dist`, `build`, `coverage`, and binary file extensions. Files larger than 512 KB are skipped. Glob patterns in `include` support `*` (within a segment), `**` (any depth), and `?` (single char). Returns `SearchFilesResult` with `matches[]`, `truncated`, `matchedFiles`, `searchedFiles`.

### update_todos

Validates the entire todo array before accepting any updates. Constraints:
- Each item must have a non-empty `content` string.
- `status` must be one of `"pending"`, `"in_progress"`, `"completed"`.
- At most one item may be `"in_progress"` at a time.

An optional `onUpdate` callback is called after validation, allowing the runtime to capture the updated list and emit `todos_updated`.

### append_daily_memory

Appends a timestamped note to `{workspaceRoot}/memory/YYYY-MM-DD.md`. Creates the `memory/` directory if it doesn't exist. The date is injectable via `options.getCurrentDate()` for test determinism.

### load_skill

Accepts a `SkillFileMap` (`Map<string, string>`) mapping skill names to file paths. Reads the skill file and returns its content. This allows adapters to register available skill files at startup without the tool needing to discover them.

### update_heartbeat

Writes a structured Markdown status file to `{workspaceRoot}/HEARTBEAT.md`. Accepts `status` (one of `running`, `completed`, `failed`, `idle`) and a `message` string. Always overwrites the previous content. Used by background tasks to signal liveness and progress; the file is automatically loaded into context on subsequent sessions via `workspacePromptFiles`.

### memory_search / memory_get

Both tools operate within a workspace root boundary:

- `memory_search`: scans `MEMORY.md`, `USER.md`, and `memory/*.md` files; performs case-insensitive word-by-word matching across paragraphs; scans ALL candidate files before applying the `maxResults` limit (default: 5), so a single large file cannot crowd out results from other files.
- `memory_get`: reads a specific file by relative path. Rejects path traversal (`..`), absolute paths, and non-`.md` extensions.

## Implementation Principles

### Why Tools Don't Decide Permissions

`ExecutableTool.risk` is metadata that describes the inherent risk level of the tool's action. The actual decision to allow, ask, or deny is made by `PermissionPolicy` in `@vole/permissions`, which combines the risk level with the current autonomy mode. This separation means:
- Tools can be registered without knowing the current mode.
- The permission policy can be swapped without changing tools.
- Tests can exercise tool logic independently of permission decisions.

### Defensive Input Handling

Every tool validates its `input: unknown` before use. If required fields are missing or wrong type, the tool returns `{ ok: false, error: { code: "invalid_input", message: "…" } }` rather than throwing. This ensures the runtime always receives a valid `ToolExecutionResult` that it can serialize into a tool role message.

## File Inventory

| File | Role | Purpose |
|---|---|---|
| `package.json` | Package manifest | Declares the tools package, export entrypoint, and build scripts. |
| `tsconfig.json` | TypeScript config | Builds the tools package. |
| `src/index.ts` | Tool registry and built-in tools | All exports: tool contracts, `InMemoryToolRegistry`, `ToolRegistryError`, all built-in tool factories, result types, `TodoItem`, `SkillFileMap`, `ShellToolOptions`. |
| `src/index.test.ts` | Tool tests | Full behavioral test suite covering all tool execution paths, safety guards, workspace boundary enforcement, and registry behavior. |

## Update Reminder

Update this file when the directory structure or module responsibilities change.

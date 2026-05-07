# Module 05: @vole/tools

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `05-tools.zh-CN.md` (create alongside this file)

Related source: `packages/tools/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 3 (Foundation Modules) in the [learning guide](./guide.md).
Read it after [04-permissions.md](./04-permissions.md) — you already know that permissions
evaluates based on `risk`, and this is where `risk` is set on each tool.

**Before reading**: Skim the tool list (all `export function createXxx`) in
`packages/tools/src/index.ts`. Note the `risk` value on each. Then read this document.

**Focus questions**:
- Why are tools created via factory functions rather than as singleton objects?
- What does `ToolExecutionContext` contain, and why is it so minimal?
- What are the three layers of shell safety, and when does each apply?
- Why does `edit_file` require `old_string` to be unique in the file?

**Checkpoint**: You understand this module when you can trace a single `read_file("../../etc/passwd")`
call through every check it fails before anything is read from disk.

## 1. What This Module Does

**Plain language**: Tools are the agent's hands. Without tools, the agent can only talk — it
cannot read files, write code, run commands, or browse the web. This package provides those
physical capabilities.

But powerful hands need safety gloves. Every tool in this package enforces its own guards:
- File tools check paths stay inside the workspace
- File tools block access to secret-looking filenames
- Shell tool blocks the most dangerous command patterns
- All outputs are capped so they cannot flood the model's context

The agent picks up a tool, the tool does its job safely, and returns a structured result.

**Technical summary**: `@vole/tools` defines the `ExecutableTool` interface, provides an
`InMemoryToolRegistry`, and implements 13 built-in tools covering file I/O, shell execution,
web reading, memory, skills, and task tracking.

It is the only package in the codebase that performs local filesystem operations, executes
shell commands, or makes web requests on behalf of tools.

## 2. Why It Exists

If tool implementations lived in core or in adapters, every adapter would carry filesystem
and shell execution logic. Tests would need real filesystems. Security logic would be
scattered across the codebase.

`@vole/tools` creates a single, auditable layer for all capabilities. Core only calls
`tool.execute(input, context)`. The safety checks, path resolution, output truncation, and
result normalisation all happen inside the tool, invisible to the caller.

## 3. Public Interface

```ts
// The capability contract
interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema   // JSON Schema for input validation
  risk: ToolRiskLevel            // "low" | "medium" | "high" | "blocked"
}

// What tools receive at execution time — intentionally minimal
interface ToolExecutionContext {
  workspaceRoot: string
}

// All tool results share this shape — errors as values, not exceptions
type ToolExecutionResult =
  | ReadFileToolResult          // { ok: true; content; summary }
  | WriteFileToolResult         // { ok: true; summary }
  | ShellToolResult             // { ok: true; exitCode; stdout; stderr; durationMs }
  | ToolExecutionFailure        // { ok: false; error: { code; message } }
  | ...  // one variant per tool type
```

**Built-in tool factory functions** (each returns `ExecutableTool`):

| Factory | Risk | What it does |
|---|---|---|
| `createReadFileTool()` | low | Read a UTF-8 file inside the workspace |
| `createListDirectoryTool()` | low | List entries in a workspace directory |
| `createReadWebPageTool(fetch?)` | low | Fetch a URL and extract plain text |
| `createSearchFilesTool()` | low | Grep-like search within workspace files |
| `createUpdateTodosTool(onUpdate?)` | low | Replace the in-turn task list |
| `createLoadSkillTool(skillFileMap)` | low | Load a skill's full body on demand |
| `createMemorySearchTool(memoryDir)` | low | Keyword search over memory files |
| `createMemoryGetTool(memoryDir)` | low | Read a specific memory file |
| `createWriteFileTool()` | medium | Write or overwrite a file |
| `createEditFileTool()` | medium | Exact string replacement in a file |
| `createAppendFileTool()` | medium | Append text to a file |
| `createAppendDailyMemoryTool(...)` | medium | Write to today's memory file |
| `createShellTool(options?)` | high | Execute a shell command |

## 4. Implementation Walkthrough

Every file tool goes through the same path:

**Step 1 — Parse and validate input**
`getPathInput(input)` extracts the path string. Invalid inputs return `inputError()`
immediately, before any filesystem access.

**Step 2 — Resolve and sandbox the path**
`resolveWorkspacePath(workspaceRoot, path)` resolves the path to absolute, then checks
that the result starts within the workspace root. A path like `../../etc/passwd` resolves
outside the root and returns `undefined` → `outsideWorkspaceError()`.

**Step 3 — Check for secret-like filenames**
`isSecretLikePath(absolutePath)` blocks `.env`, `.env.*`, `.netrc`, `.key`, `.pem`,
`id_rsa`, `id_ed25519`, and similar. The check is on the filename alone, not the content.

**Step 4 — Execute the filesystem operation**

**Step 5 — Return structured result or error**
All errors are `{ ok: false, error: { code, message } }`. Never thrown.

The shell tool has additional steps between 1 and 4:
- `isBlockedCommand()`: regex blocklist, always applied
- `isSandboxEscape()`: path traversal check, only when `sandboxed: true`

## 5. OpenClaw Alignment

| OpenClaw | Vole | Notes |
|---|---|---|
| Built-in tool set | `@vole/tools` built-ins | Same capability categories |
| Workspace sandboxing | `resolveWorkspacePath` + shell cwd | Similar approach |
| Secret file protection | `isSecretLikePath` | Vole-specific heuristic list |
| `memory_search` / `memory_get` | `createMemorySearchTool` / `createMemoryGetTool` | OpenClaw-aligned names |
| `update_plan` tool | `createUpdateTodosTool` | Same pattern; see Section 8 |

OpenClaw's tool system has more tools and supports plugin-contributed tools. Vole's
built-in set covers the essential capabilities for a coding/research agent.

## 6. Key Design Decisions

**Factory functions, not singletons**

Tools need external dependencies injected at creation time:
- `createReadWebPageTool(fetchFn)` → tests inject a fake fetch
- `createShellTool({ sandboxed: true })` → production enables sandboxing
- `createMemorySearchTool(memoryDir)` → runtime-specific path

Singletons cannot vary these. Factory functions create fresh tool instances
with the right configuration for the current context.

**`ToolExecutionContext` is intentionally minimal**

Only `workspaceRoot: string`. Tools do not need session data, model configuration,
permission policies, or user context. Keeping the context minimal makes tools
independently testable and reusable outside the full agent stack.

**Errors as values, not exceptions**

`ToolExecutionResult` includes `ToolExecutionFailure: { ok: false; error: { code; message } }`.
Tools never throw. This matches the pattern in `@vole/models` — the caller (`core`) handles
all three outcomes (`ok: true`, `ok: false`, exception caught by core) without needing a
try/catch wrapping every tool call.

**`edit_file` enforces uniqueness of `old_string`**

`write_file` replaces the entire file — one mistake wipes out all surrounding code.
`edit_file` requires `old_string` to appear exactly once (unless `replace_all: true`).
If it appears multiple times, the tool errors with a message asking for more context.
This forces the model to make precise, targeted changes rather than lazy full rewrites.

**Output truncation prevents context flooding**

Shell output is capped at 4,000 characters; web page content at 8,000. Exceeding the
limit appends `[truncated N characters]`. Without this, a `cat large_file.log` could
consume the model's entire context window in one tool call.

## 7. Testing Approach

Tests are in `packages/tools/src/index.test.ts`. All filesystem operations use a real
temporary directory (`mkdtemp`) — no mocking of Node.js built-ins.

The shell tool tests use simple `echo` commands to verify execution without side effects.
`createReadWebPageTool` accepts an injectable `fetch` function for testing without real
HTTP.

Test categories:
- Workspace sandboxing (path traversal blocked, root-relative paths work)
- Secret file protection (`.env`, `.pem` blocked; regular files allowed)
- `edit_file` uniqueness enforcement (not found, multiple matches, success)
- Shell blocklist (fork bombs, `rm -rf /` blocked; safe commands pass)
- Shell sandbox escape detection
- Output truncation
- `update_todos` validation (at most one `in_progress`)

## 8. Insights

**`read_web_page` is `low` risk.** This surprises new readers. The reasoning: it is
read-only and has no side effects on the local system. The same logic applies to
`memory_search` and `read_file`. Risk tracks the potential for harm to the local
environment, not sensitivity of the data accessed.

**Shell safety is defense-in-depth, not a security boundary.** The blocklist and sandbox
patterns are heuristics — they catch common mistakes and obvious attacks, not all possible
dangerous commands. The real safety boundary is the `high` risk level on `run_shell`
combined with the permission system: in `confirm` mode (default), every shell command
requires explicit user approval.

**`edit_file` over `write_file` for code modifications.** When the model needs to change
one function in a 500-line file, `write_file` requires it to reproduce all 500 lines
correctly. `edit_file` requires only the exact string to replace and its replacement.
This reduces token cost and eliminates the risk of the model accidentally omitting code.

**`update_todos` does not own its state.** The `onUpdate` callback is how core receives
the updated todo list. The tool itself has no stored state between calls. State management
lives in `AgentRuntime` (`#currentTodos`), not in the tool.

**Three categories of tool safety**: path-based (workspace sandbox, secret files),
content-based (shell blocklist), and output-based (truncation). Each addresses a different
failure mode.

## 9. Review Questions

1. Why are tools created via factory functions instead of being exported as pre-built
   singleton instances?
   > Tools need external dependencies injected at creation time: a fetch function for web
   > tools, a memory directory path for memory tools, sandboxing options for shell. Factory
   > functions allow each consumer to inject the right dependencies for their context.

2. A model calls `read_file` with path `"../../../etc/passwd"`. Walk through every check
   before the tool attempts to read the file.
   > (1) `getPathInput` extracts the path string. (2) `resolveWorkspacePath` resolves it to
   > an absolute path, then checks `relative(workspaceRoot, absolute)` — it starts with
   > `../../..`, so returns `undefined` → `outsideWorkspaceError()`. The filesystem is never
   > touched.

3. Why is `ToolExecutionContext` so minimal (only `workspaceRoot`)?
   > Tools need only to know where the workspace is. Keeping context minimal makes tools
   > independently testable without a full agent stack, and prevents tools from coupling to
   > session data, model configuration, or permission policies.

4. What is the difference between `write_file` and `edit_file`? When should each be used?
   > `write_file` replaces the entire file. `edit_file` replaces an exact string occurrence
   > (must be unique, or use `replace_all: true`). Use `edit_file` when modifying existing
   > code — it preserves surrounding content and forces the model to be precise.

5. Why is `read_web_page` classified as `low` risk while `write_file` is `medium`?
   > Risk tracks potential harm to the local environment. `read_web_page` is read-only
   > with no local side effects. `write_file` modifies the filesystem. Risk is not about
   > sensitivity of data accessed, but about what damage the operation could cause locally.

6. Shell safety uses three mechanisms. Name them and explain when each applies.
   > (1) Blocklist (`BLOCKED_COMMAND_PATTERNS`): regex patterns checked on every command,
   > always active — blocks `rm -rf /`, fork bombs, disk tools.
   > (2) Sandbox escape detection (`SANDBOX_ESCAPE_PATTERNS`): path traversal and `cd /`
   > patterns, only active when `sandboxed: true`.
   > (3) Working directory: shell always runs with `cwd = workspaceRoot`, limiting relative
   > path operations regardless of the other checks.

7. `update_todos` has an `onUpdate?: (todos: TodoItem[]) => void` callback. Why is state
   not stored inside the tool itself?
   > Tools are stateless — they produce results and return. State management belongs to the
   > caller. `AgentRuntime` holds `#currentTodos` and passes a callback at tool creation
   > time. This keeps the tool's responsibility narrow: validate and parse the input, call
   > the callback, return `{ ok: true }`.

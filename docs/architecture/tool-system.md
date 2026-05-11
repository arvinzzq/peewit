# Tool System

Status: Active
Date: 2026-05-11

Simplified Chinese version: [tool-system.zh-CN.md](./tool-system.zh-CN.md)

## 1. Purpose

The tool system is how Vole lets the agent act outside the model.

Models can generate text, but tools let the agent inspect files, run commands, read web pages, write documents, and eventually control browsers or background tasks.

The core rule:

Tools describe and execute capabilities. Permissions decide whether a specific action is allowed.

## 2. Why Tools Need Structure

Without a tool system, every external action becomes a special case inside Agent Core.

A structured tool system gives Vole:

- A consistent way to expose capabilities to models
- Input validation before execution
- Normalized tool results
- Risk metadata for permission checks
- Traceable execution records
- A way to add future capabilities without rewriting Agent Core

## 3. MVP Tools

The MVP tool set should include:

- File read
- Directory list
- File write
- Shell command execution
- Web search
- Web page reading

Deferred tools:

- Browser automation
- Long-term memory tools
- Background task tools
- Remote node tools
- Full sandboxed code execution

## 4. Tool Responsibilities

A tool owns:

- Name and description
- Input schema
- Output shape
- Execution implementation
- Default risk metadata
- Result normalization
- Tool-specific error normalization

A tool does not own:

- Whether the action should be allowed
- How the user is asked for approval
- How the result is rendered in CLI or Web UI
- How session history is stored
- How the model chooses the tool

## 5. Tool Registry

The Tool Registry is the catalog of tools available to the agent.

It should support:

- Registering tools
- Looking up a tool by name
- Listing tools for CLI display
- Producing model-facing tool definitions
- Producing trace-friendly tool metadata

The Agent Core should ask the registry for available tools. It should not hard-code every tool.

## 6. Tool Definition Shape

The implementation plan should refine exact types, but a tool concept may look like:

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  risk: ToolRiskMetadata;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}
```

The schema should be machine-readable so the system can validate model-generated tool inputs before execution.

## 7. Tool Input Validation

Model-generated tool calls are untrusted until validated.

Before any tool executes, the system should:

- Verify the tool exists
- Validate input against the tool schema
- Normalize paths, URLs, and command strings as needed
- Reject malformed input with a clear trace event

Invalid inputs should be treated as observations back to the agent, not as crashes.

## 8. Tool Result Shape

Tool results should be normalized so Agent Core and traces can handle them consistently.

Useful result fields:

- `ok`: whether execution succeeded
- `summary`: short human-readable summary
- `data`: structured result data
- `content`: text content when relevant
- `source`: URL or file path when relevant
- `metadata`: timing, size, status code, or other details
- `error`: normalized error when failed

Large outputs should be summarized or truncated for model context while preserving a trace record that tells the user what happened.

## 9. Risk Metadata

Tools should provide default risk metadata, but the permission system makes the final decision.

Examples:

| Tool | Default Risk | Notes |
| --- | --- | --- |
| Directory list | Low | Low only inside workspace |
| File read | Low | Higher risk for paths outside workspace or likely secrets |
| File write | Medium | Requires confirmation by default |
| Shell command | High | Requires explicit confirmation by default |
| Web search | Low | Source URLs should be recorded |
| Web page read | Low | Public page reads are usually low risk |

Risk may depend on input. For example:

- Reading `README.md` inside the workspace is Low.
- Reading `.env` is Blocked by default.
- Writing a new documentation file may be Medium.
- Deleting a file is High or Blocked depending on scope.
- Running `rm -rf` is Blocked by default.

## 10. Built-In Tool Groups

### File Tools

File tools should operate within a workspace boundary by default.

Initial tools:

- `list_directory`
- `read_file`
- `write_file`

Possible future tools:

- `edit_file`
- `search_files`
- `create_directory`
- `delete_file`

### Shell Tool

The shell tool runs commands in a configured working directory.

Initial behavior:

- High risk by default
- Requires explicit confirmation
- Captures stdout, stderr, exit code, and duration
- Has timeout limits
- Records the command in trace

Future behavior:

- Command allowlist
- Denylist for known destructive commands
- Sandboxed execution
- Per-project command policies

### Web Tools

Web tools should be split into:

- `web_search`
- `read_web_page`

Search returns candidate sources. Page reading fetches and cleans a selected source.

The agent should preserve URLs in trace output so users can inspect sources.

## 11. Tool Execution Flow

Tool execution should follow this sequence:

```text
Model requests tool
  -> Agent Core resolves tool from registry
  -> Validate tool input
  -> Build ToolAction
  -> PermissionPolicy evaluates ToolAction
  -> Adapter asks user if needed
  -> Execute tool if allowed
  -> Normalize result
  -> Record trace event
  -> Return observation to Agent Core
```

This keeps model choice, permission policy, adapter approval, and tool execution separate.

## 12. Tool Errors

Tool errors should be normalized and returned as observations.

Examples:

- File not found
- Permission denied by OS
- Path outside workspace
- Invalid URL
- Network timeout
- Command timeout
- Non-zero command exit
- Output too large

The agent can then decide whether to retry, ask the user, choose a different tool, or stop.

## 13. Workspace Boundary

File and shell tools should respect a configured workspace boundary.

By default:

- File read/list actions are Low only inside the workspace.
- File write actions require confirmation.
- Paths outside the workspace require higher risk classification.
- Likely secret files should be Blocked by default.

This boundary is especially important because Vole is intended to become more autonomous over time.

## 14. Tool Context

Tools should receive execution context such as:

- Workspace root
- Current working directory
- Environment policy
- Timeout policy
- Trace ID
- Cancellation signal

Tools should not receive unrestricted access to all runtime internals.

## 15. Extensibility

Future tools should be addable through the registry.

Later phases may introduce:

- Plugin-provided tools
- Skill-associated tools
- Remote node tools
- Browser automation tools
- Memory tools
- Calendar or email tools

Each new tool should still follow the same contract:

```text
Describe capability
  -> Validate input
  -> Expose risk metadata
  -> Execute through controlled context
  -> Return normalized result
```

## 16. Acceptance Criteria

The MVP tool system should be considered successful when:

- Tools can be registered without changing Agent Core.
- Tool inputs are validated before execution.
- Tool results are normalized.
- Tool calls appear in the execution trace.
- Permission checks happen before execution.
- File, shell, web search, and web page tools can follow the same execution flow.
- Tool-specific errors are returned as observations instead of crashing the agent loop.

## 17. Related Documents

- [Main design](../product/vole-design.md)
- [Roadmap](../roadmap/overview.md)
- [Agent loop](./agent-loop.md)
- [Model provider](./model-provider.md)
- [Project structure](./project-structure.md)

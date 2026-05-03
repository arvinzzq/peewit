# Phase 2 Tools and Permissions Plan

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [phase-2-tools-and-permissions.zh-CN.md](./phase-2-tools-and-permissions.zh-CN.md)

## Progress

Status: In Progress

Completed:

- Tool definition contracts and in-memory registry: pending commit

Remaining:

- Permission decision types and policy.
- Runtime handling for model-requested tool calls.
- CLI approval prompt flow.
- Built-in file tools.
- Tool lifecycle and permission trace events.

Next recommended slice:

- Add permission decision types and default policy.

## 1. Purpose

Phase 2 gives ArvinClaw the first real external action capability.

The goal is to let the agent inspect files, write files after approval, run shell commands after approval, and read web content through safe tool and permission boundaries.

Core rule:

Model-requested actions are untrusted until validated, permissioned, executed, and traced.

## 2. User Result

After Phase 2, the user should be able to:

- Ask the agent to inspect files in the workspace.
- Ask the agent to list directories.
- Approve file writes.
- Approve shell commands.
- Ask the agent to search or read configured web content.
- See tool calls and permission decisions in trace output.

## 3. Scope

Phase 2 includes:

- Tool interface and registry.
- Built-in file tools.
- Built-in shell tool.
- Basic web search or web page reader, depending on provider readiness.
- Tool input validation.
- Permission risk classification.
- CLI permission prompts.
- Tool trace events.
- Safety regression tests.

Phase 2 does not include:

- Full sandboxing.
- Browser automation.
- Remote tool nodes.
- Long-term memory tools.
- Background automation tools.
- Plugin-provided tools.

## 4. Planned Work

Recommended order:

1. Add tool domain types and registry.
2. Add fake tools for runtime tests.
3. Add permission decision types and policy.
4. Wire tool-call handling into AgentRuntime using fake model output.
5. Add CLI approval prompt flow.
6. Add file read and directory list tools.
7. Add file write tool with confirmation.
8. Add shell tool with confirmation, timeout, and captured output.
9. Add web search or page reader through a configured provider.
10. Add trace events for tool lifecycle and permission decisions.
11. Add safety regression tests.

Each step should keep the system runnable.

## 5. Tool Registry

The tool registry should support:

- Registering built-in tools.
- Looking up a tool by name.
- Listing tools for model projection.
- Listing tools for CLI display.
- Exposing trace-friendly metadata.

Agent Core should use the registry instead of hard-coding tools.

## 6. Tool Interface

The first implementation should support:

- Tool name
- Description
- Input schema
- Default risk metadata
- Validation
- Execution
- Normalized result

Exact TypeScript shape can follow [Architecture Contracts](../architecture/contracts.md), but implementation may adjust details.

## 7. File Tools

Initial file tools:

- `list_directory`
- `read_file`
- `write_file`

Rules:

- Default to workspace boundary.
- Normalize paths before permission evaluation.
- Treat likely secret files as blocked.
- Truncate or summarize large outputs.
- Record file path, action, and result summary in trace.

`write_file` should require confirmation by default.

## 8. Shell Tool

Initial shell tool behavior:

- High risk by default.
- Requires explicit confirmation.
- Runs in configured workspace or working directory.
- Captures stdout, stderr, exit code, and duration.
- Enforces timeout.
- Blocks known destructive command patterns where practical.
- Records command summary in trace.

Shell output should be summarized for model context when large.

## 9. Web Tools

Web support can start with one of two approaches:

- `read_web_page` first, if the user provides URLs.
- `web_search` first, if a search provider is configured.

Either path should:

- Preserve source URLs.
- Normalize fetch/search errors.
- Avoid sending secrets.
- Record source metadata in trace.
- Be easy to disable from config.

The concrete first provider can be selected during implementation.

## 10. Permission Policy

The MVP permission policy should support:

- `allow`
- `ask`
- `deny`

Risk levels:

- Low
- Medium
- High
- Blocked

Default behavior in `confirm` mode:

- Low risk: auto-allow.
- Medium risk: ask.
- High risk: ask with stronger risk explanation.
- Blocked: deny.

## 11. CLI Approval Flow

When a tool action requires approval, AgentRuntime emits an approval request.

CLI should show:

- Tool name.
- Action summary.
- Risk level.
- Permission reason.
- Relevant path, URL, or command.
- Available choices.

MVP choices:

- Approve once.
- Deny.
- Show details.

Session-level approvals can be deferred.

## 12. Trace Events

Phase 2 should add trace events such as:

- `tool_call_requested`
- `tool_input_validated`
- `permission_evaluated`
- `approval_requested`
- `approval_resolved`
- `tool_started`
- `tool_completed`
- `tool_failed`
- `tool_denied`

Trace should show what happened without exposing raw secrets or excessive output.

## 13. Context Integration

The context assembler should include tool definitions in model input.

It should not include:

- Tool implementation details.
- Secret configuration.
- Permission bypass instructions.

Permission guidance can be included as policy summary, but the model cannot grant itself permission.

## 14. Tests

Required Phase 2 tests:

- Tool registry lookup and listing.
- Unknown tool rejection.
- Tool input validation failure.
- File read inside workspace.
- Secret-like file blocked.
- Path outside workspace classified higher risk.
- File write requires approval.
- Shell command requires approval.
- Dangerous shell pattern denied or blocked.
- Tool result normalization.
- Permission decision trace events.
- CLI approval prompt forwards approve and deny decisions.
- AgentRuntime handles fake tool calls end to end.
- Web tool error normalization if web tools are included.

No normal test should run destructive commands or require network access.

## 15. Verification Commands

Phase 2 should end with equivalents of:

```text
typecheck
unit tests
integration tests
safety regression tests
CLI approval flow smoke test
documentation checks
```

Network-dependent web tests should be opt-in or use fixtures.

## 16. Commit Plan

Suggested fine-grained commits:

1. `feat(tools): add tool registry`
2. `feat(permissions): add permission policy`
3. `feat(core): handle model tool calls`
4. `feat(cli): add approval prompts`
5. `feat(tools): add file read and list tools`
6. `feat(tools): add guarded file write`
7. `feat(tools): add guarded shell tool`
8. `feat(tools): add web read capability`
9. `test: cover tool and permission safety`

The exact order can shift if implementation reveals a better dependency sequence.

## 17. Acceptance Criteria

Phase 2 is complete when:

- Tools can be registered without changing Agent Core logic.
- Model-requested tool calls are validated before execution.
- Permission policy evaluates every tool action.
- CLI can ask for approval and return the user decision to runtime.
- File read/list/write tools work within workspace rules.
- Shell commands require explicit approval by default.
- Web read/search capability is available or explicitly deferred with rationale.
- Tool and permission events appear in trace.
- Safety-sensitive behavior is covered by tests.

## 18. Related Documents

- [Roadmap](../roadmap/overview.md)
- [Tool System](../architecture/tool-system.md)
- [Permission System](../architecture/permission-system.md)
- [CLI Adapter](../architecture/cli-adapter.md)
- [Agent Loop](../architecture/agent-loop.md)
- [Execution Trace](../architecture/execution-trace.md)
- [Runtime Composition](../architecture/runtime-composition.md)
- [Architecture Contracts](../architecture/contracts.md)
- [Testing Strategy](../architecture/testing-strategy.md)
- [Development Workflow](../architecture/dev-workflow.md)

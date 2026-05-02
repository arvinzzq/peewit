# Permission System

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [permission-system.zh-CN.md](./permission-system.zh-CN.md)

## 1. Purpose

The permission system decides whether a specific agent action is allowed to run.

ArvinClaw should become increasingly capable over time, but more capability means more risk. The permission system is the boundary that lets the agent act while keeping the user in control.

The core rule:

The model may request an action, and a tool may know how to execute it, but the permission system decides whether that action is allowed.

## 2. Why This Module Exists

General-purpose agents can touch files, run commands, access the web, and eventually automate background tasks. Without a permission system, every new capability increases the chance of accidental damage or surprising behavior.

The permission system gives ArvinClaw:

- A consistent safety model across tools
- A way to support different autonomy modes
- A traceable record of why actions were allowed or blocked
- A clear boundary between tool capability and user approval
- A foundation for future plugin and skill trust decisions

## 3. Risk Levels

MVP permissions use four risk levels.

| Risk | Meaning | Default Behavior |
| --- | --- | --- |
| Low | Expected to be safe in normal workspace use | Automatically allowed in `confirm` and `auto` |
| Medium | Can change local state or access broader context | Requires confirmation |
| High | Can cause significant change, run code, or expose data | Requires explicit confirmation with risk explanation |
| Blocked | Known dangerous or sensitive action | Denied by default unless explicitly allowed |

Risk levels are not only properties of tools. They also depend on the tool input, workspace, configuration, and autonomy mode.

## 4. Example Risk Classification

| Action | Risk | Reason |
| --- | --- | --- |
| List files inside workspace | Low | Read-only and scoped |
| Read `README.md` inside workspace | Low | Read-only and scoped |
| Read `.env` | Blocked | Likely contains secrets |
| Write a new documentation file | Medium | Changes local state |
| Modify source code | Medium | Changes project behavior |
| Run a shell command | High | Executes code or system commands |
| Run `rm -rf` | Blocked | Destructive command |
| Read a public web page | Low | Read-only external access |
| Submit file contents to a remote service | High | May expose user data |

## 5. Autonomy Mode Interaction

Autonomy modes change how often the user is interrupted, but they do not remove permission checks.

### `observe`

Best for learning and debugging.

Expected behavior:

- Pause before most actions.
- Show the planned action.
- Show the risk classification.
- Wait for user confirmation.

### `confirm`

Default MVP mode.

Expected behavior:

- Low risk actions can run automatically.
- Medium and High risk actions require confirmation.
- Blocked actions are denied unless explicitly allowed.

### `auto`

Used for trusted automation.

Expected behavior:

- Low and configured Medium risk actions may run automatically.
- High risk actions may still require confirmation unless policy allows them.
- Blocked actions remain blocked unless explicitly allowed.

## 6. Permission Decision Shape

The implementation plan should refine exact types, but the architecture expects a decision shape like:

```ts
type PermissionDecision =
  | { type: "allow"; risk: RiskLevel; reason: string }
  | { type: "ask"; risk: RiskLevel; reason: string; prompt: string }
  | { type: "deny"; risk: RiskLevel; reason: string };
```

The decision should include a human-readable reason so it can appear in the execution trace and approval prompt.

## 7. Permission Evaluation Inputs

Permission evaluation should consider:

- Tool name
- Tool input
- Tool default risk metadata
- Workspace root
- Current working directory
- Target file paths or URLs
- Autonomy mode
- User and project configuration
- Previous approvals in the current session
- Whether an action matches allowlists or blocklists

The model's confidence or wording should not be enough to approve an action.

## 8. Approval Flow

The permission system does not ask the user directly. It returns a decision to Agent Core.

Approval flow:

```text
ToolAction
  -> PermissionPolicy.evaluate
  -> allow: execute tool
  -> ask: adapter asks user
  -> deny: record denial observation
```

The adapter owns presentation:

- CLI asks in the terminal.
- Web UI shows an approval panel.
- Background automation records a pending approval or stops safely.

## 9. Trace Requirements

Every non-trivial permission decision should appear in the execution trace.

Trace entry should include:

- Tool/action name
- Risk level
- Decision type
- Reason
- Whether user approval was requested
- Whether user approved or denied

This is important for both safety and learning. Users should be able to understand why the agent stopped or continued.

## 10. Configuration

MVP configuration can support:

- Default autonomy mode
- Workspace root
- Enabled tools
- Blocked path patterns
- Allowed path patterns
- Shell command timeout
- Optional shell allowlist in later phases

Sensitive settings should not be stored in project config.

## 11. Workspace Boundary

Workspace boundaries are central to permission evaluation.

Default policy:

- Read-only actions inside workspace can often be Low risk.
- Writes inside workspace are usually Medium risk.
- Access outside workspace should be Medium or High risk.
- Secret-like files should be Blocked by default.

Examples of secret-like files:

- `.env`
- `.npmrc`
- SSH keys
- Cloud credential files
- Files matching configured secret patterns

## 12. Shell Safety

Shell execution should start as High risk.

The system should record:

- Command
- Working directory
- Purpose summary
- Risk explanation
- Timeout

Future versions may add:

- Safe command allowlist
- Dangerous command denylist
- Sandboxed command execution
- Project-specific shell policies

## 13. Session Approvals

Later versions may allow temporary approvals, such as:

- Allow this exact action once
- Allow this tool for this session
- Allow writes under this directory for this task

MVP can start with one-time approvals only. This is easier to reason about and safer while the system is young.

## 14. Testing Requirements

The permission system needs strong tests because it protects high-risk behavior.

Required test areas:

- Risk classification for common file actions
- Secret path blocking
- Workspace boundary handling
- Shell command default High risk behavior
- Blocked command behavior
- Autonomy mode differences
- Approval decision shape
- Trace entries for allow, ask, and deny decisions
- Regression tests for any newly discovered unsafe case

Permission tests should be part of every iteration that changes tools, configuration, autonomy modes, or adapter approval behavior.

## 15. Acceptance Criteria

The MVP permission system should be considered successful when:

- Every tool call is evaluated before execution.
- Low, Medium, High, and Blocked decisions are supported.
- `confirm` mode auto-allows Low risk actions and asks for Medium/High.
- Blocked actions are denied by default.
- Shell commands require explicit confirmation by default.
- Secret-like paths are blocked by default.
- Permission decisions are visible in the execution trace.
- Permission behavior is covered by unit and integration tests.

## 16. Related Documents

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Agent loop](./agent-loop.md)
- [Tool system](./tool-system.md)
- [Project structure](./project-structure.md)

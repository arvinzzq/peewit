# Sandboxing

Status: Phase 10
Date: 2026-05-05

Simplified Chinese version: [sandboxing.zh-CN.md](./sandboxing.zh-CN.md)

## 1. Purpose

This document describes ArvinClaw's current sandbox state, the restrictions applied to shell and file tools, workspace-boundary enforcement, the blocked command policy, and Phase 10 additions.

## 2. Current Sandbox State

ArvinClaw's sandbox is implemented through tool-level guards in `packages/tools`. There is no OS-level process isolation. The sandbox is a set of input validation and path restriction rules enforced before any filesystem or shell operation.

The current sandbox protections are:

- **Workspace boundary**: all file and directory operations resolve paths relative to `workspaceRoot`; any path that escapes the workspace root is rejected with a `path_outside_workspace` error.
- **Secret file blocking**: paths matching `.env`, `.env.*`, `.netrc`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `id_ecdsa`, and `id_dsa` are rejected.
- **Blocked command patterns**: shell commands matching specific destructive patterns are rejected before execution.
- **Shell timeout**: shell commands are limited to a default of 30 seconds.
- **Output truncation**: shell stdout and stderr are truncated at 4,000 characters.

## 3. Shell Tool Restrictions

The `run_shell` tool runs shell commands in the `workspaceRoot` directory using Node.js `child_process.exec`. Restrictions:

- Command runs as the same user as the ArvinClaw process — no privilege escalation.
- The working directory is always `workspaceRoot`; the model cannot change it with `cd` in a persistent way.
- Timeout is enforced via the `exec` `timeout` option; killed processes return an error.

## 4. Workspace-Boundary Enforcement

The `resolveWorkspacePath` function in `packages/tools` enforces the boundary:

1. Resolve both `workspaceRoot` and the requested `path` to absolute paths.
2. Compute the relative path from root to absolute.
3. If the relative path starts with `..` or resolves outside the root, reject.

This prevents both `../` traversal and symlink tricks that rely on `..` components.

## 5. Blocked Command Policy

The following command patterns are always rejected regardless of permission level:

- `rm -r*` targeting `/` or `~` — prevents recursive deletion of root or home.
- Fork bomb pattern `:(){ ... }` — prevents process exhaustion.
- Pipe or write to block devices (`/dev/sd*`, `/dev/hd*`, `/dev/nvme*`, `/dev/vd*`) — prevents disk writes.
- Disk management tools: `mkfs`, `fdisk`, `parted`, `shred` — prevents disk formatting.

These are enforced in `isBlockedCommand` in `packages/tools/src/index.ts`. The policy is conservative; additional patterns may be added in future phases.

## 6. Phase 10 Additions

Phase 10 does not add OS-level sandboxing. The additions in Phase 10 are organizational:

- **Sub-agent workspace**: sub-agents inherit the parent's `workspaceRoot`; they are subject to the same workspace boundary rules.
- **Gateway session tracking**: the `SessionGateway` records which adapter created a session, making it possible to audit which surface triggered a tool call in a future phase.
- **Documentation**: this document establishes the sandbox baseline for future hardening decisions.

## 7. Future Hardening

Future phases may add:

- OS-level sandbox (macOS Sandbox profiles, Linux seccomp, or a container boundary).
- Per-session workspace isolation: each session gets its own subdirectory.
- Tool allowlist per adapter: background adapters may be restricted to read-only tools.
- Network access control: restrict `read_web_page` to approved domains.

## 8. References

- [Tool System](./tool-system.md) — tool registry and execution contracts
- [Permission System](./permission-system.md) — risk levels and approval policy
- [Multi-Agent Runtime](./multi-agent-runtime.md) — sub-agent workspace inheritance

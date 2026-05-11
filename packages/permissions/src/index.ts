/**
 * INPUT: Tool actions, autonomy mode, risk metadata; sandbox commands + options for execution backends.
 * OUTPUT: Permission decisions (allow / ask / deny) plus the SandboxBackend interface with the WorkspaceSandbox reference backend. DockerSandbox and WorkerThreadSandbox are deferred to Phase 16b.
 * POS: Permission layer; decides allow, ask, or deny and owns the execution-boundary backend abstraction. Does not execute tools directly except through sandbox.execute.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { exec } from "node:child_process";
import { resolve, sep } from "node:path";

export const permissionsPackageName = "@vole/permissions";

export type AutonomyMode = "observe" | "confirm" | "auto";
export type PermissionRiskLevel = "low" | "medium" | "high" | "blocked";
export type PermissionDecisionType = "allow" | "ask" | "deny";

export interface PermissionAction {
  kind: "tool";
  name: string;
  summary: string;
  risk: PermissionRiskLevel;
}

export interface PermissionEvaluationInput {
  mode: AutonomyMode;
  action: PermissionAction;
}

export interface PermissionDecision {
  decision: PermissionDecisionType;
  risk: PermissionRiskLevel;
  reason: string;
}

export interface PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision {
    const risk = input.action.risk;

    if (risk === "blocked") {
      return {
        decision: "deny",
        risk,
        reason: "Blocked actions are denied."
      };
    }

    if (input.mode === "observe") {
      return {
        decision: "ask",
        risk,
        reason: "Observe mode asks before external actions."
      };
    }

    if (input.mode === "auto") {
      return risk === "high"
        ? {
            decision: "ask",
            risk,
            reason: "High-risk action requires approval in auto mode."
          }
        : {
            decision: "allow",
            risk,
            reason: "Low and medium-risk actions are allowed in auto mode."
          };
    }

    return risk === "low"
      ? {
          decision: "allow",
          risk,
          reason: "Low-risk action is allowed in confirm mode."
        }
      : {
          decision: "ask",
          risk,
          reason: "Medium and high-risk actions require approval in confirm mode."
        };
  }
}

export class AlwaysAllowPolicy implements PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision {
    const risk = input.action.risk;
    if (risk === "blocked") {
      return { decision: "deny", risk, reason: "Blocked actions are always denied." };
    }
    return { decision: "allow", risk, reason: "AlwaysAllowPolicy permits all non-blocked actions." };
  }
}

export type SandboxBackendName = "workspace" | "docker" | "worker";

export interface SandboxCommand {
  command: string;
}

export interface SandboxOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxMemoryMB?: number;
  network?: "allow" | "deny";
}

export type SandboxResult =
  | {
      completed: true;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }
  | {
      completed: false;
      reason: "timeout" | "rejected" | "unavailable";
      message: string;
    };

export interface SandboxBackend {
  readonly name: SandboxBackendName;
  execute(command: SandboxCommand, options?: SandboxOptions): Promise<SandboxResult>;
  available(): Promise<boolean>;
}

const WORKSPACE_SANDBOX_ESCAPE_PATTERNS: RegExp[] = [
  /\/\.\.\//,
  /\bcd\s+\/(\s|$)/,
  /\bcd\s+~\/?(\s|$)/
];

function isWorkspaceSandboxEscape(command: string): boolean {
  return WORKSPACE_SANDBOX_ESCAPE_PATTERNS.some((pattern) => pattern.test(command));
}

function isInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  const root = resolve(workspaceRoot);
  const target = resolve(workspaceRoot, candidate);
  if (target === root) return true;
  return target.startsWith(root + sep);
}

export interface WorkspaceSandboxOptions {
  workspaceRoot: string;
  defaultTimeoutMs?: number;
}

export class WorkspaceSandbox implements SandboxBackend {
  readonly name = "workspace" as const;
  private readonly workspaceRoot: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: WorkspaceSandboxOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  async available(): Promise<boolean> {
    return true;
  }

  execute(command: SandboxCommand, options: SandboxOptions = {}): Promise<SandboxResult> {
    if (isWorkspaceSandboxEscape(command.command)) {
      return Promise.resolve({
        completed: false,
        reason: "rejected",
        message: "Command rejected: workspace sandbox prevents execution outside workspace."
      });
    }

    const requestedCwd = options.cwd;
    if (requestedCwd !== undefined && !isInsideWorkspace(this.workspaceRoot, requestedCwd)) {
      return Promise.resolve({
        completed: false,
        reason: "rejected",
        message: "Command rejected: requested cwd is outside the workspace."
      });
    }

    const cwd = requestedCwd === undefined ? this.workspaceRoot : resolve(this.workspaceRoot, requestedCwd);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<SandboxResult>((resolveResult) => {
      const start = Date.now();
      exec(
        command.command,
        { cwd, timeout: timeoutMs, env: options.env },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - start;
          if (error?.killed === true) {
            resolveResult({
              completed: false,
              reason: "timeout",
              message: `Command exceeded timeout of ${timeoutMs}ms.`
            });
            return;
          }
          const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
          resolveResult({
            completed: true,
            exitCode,
            stdout,
            stderr,
            durationMs
          });
        }
      );
    });
  }
}

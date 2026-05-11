/**
 * INPUT: Tool actions, autonomy mode, risk metadata; sandbox commands + options for execution backends.
 * OUTPUT: Permission decisions (allow / ask / deny) plus the SandboxBackend interface with three implementations: WorkspaceSandbox (default; shell-cwd lock + escape pattern checks), WorkerThreadSandbox (JS isolation via node:worker_threads with timeout + memory cap), DockerSandbox (per-execution container with workspace mounted read-only, gated on docker daemon availability).
 * POS: Permission layer; decides allow, ask, or deny and owns the execution-boundary backend abstraction. Does not execute tools directly except through sandbox.execute.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { exec } from "node:child_process";
import { resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";

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

// ─── Phase 16b Step 4: WorkerThreadSandbox ─────────────────────────────────────

export interface WorkerThreadSandboxOptions {
  /** Default timeout when SandboxOptions.timeoutMs is not set. */
  defaultTimeoutMs?: number;
  /** Default memory cap in MB; maps to Worker resourceLimits.maxOldGenerationSizeMb. */
  defaultMaxMemoryMB?: number;
}

/**
 * The bootstrap script that runs inside the Worker. Receives `command` (a JS
 * snippet) via workerData, evaluates it inside a Function constructor scope,
 * and posts the stringified result + duration back to the parent. Errors are
 * surfaced as exitCode=1 with stderr=<message>.
 */
const WORKER_SANDBOX_BOOTSTRAP = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
async function main() {
  const start = Date.now();
  try {
    const fn = new Function('return (async () => { ' + workerData.command + ' })()');
    const result = await fn();
    parentPort.postMessage({
      ok: true,
      stdout: result === undefined ? '' : String(result),
      durationMs: Date.now() - start
    });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      stderr: error && error.message ? String(error.message) : String(error),
      durationMs: Date.now() - start
    });
  }
}
main();
`;

/**
 * WorkerThreadSandbox executes a JavaScript snippet inside a `node:worker_threads`
 * Worker. The worker boots from an inline bootstrap that wraps the snippet in
 * an async function — so plain expressions, `await`-using bodies, and explicit
 * `return value;` all behave naturally. The worker has no shared module map
 * with the parent process; if the snippet calls `require('node:fs')` it gets
 * Node's standard module loader, so this backend is best treated as
 * "untrusted-JS bounded by timeout + memory cap" rather than a strict capability
 * sandbox. Stronger isolation (deny-list specific modules, RPC tool calls back
 * to the parent) is a follow-up; the contract here gives callers the timeout /
 * memory enforcement and the SandboxResult shape they would get from any other
 * backend.
 */
export class WorkerThreadSandbox implements SandboxBackend {
  readonly name = "worker" as const;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxMemoryMB: number;

  constructor(options: WorkerThreadSandboxOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.defaultMaxMemoryMB = options.defaultMaxMemoryMB ?? 64;
  }

  async available(): Promise<boolean> {
    return true;
  }

  execute(command: SandboxCommand, options: SandboxOptions = {}): Promise<SandboxResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxMemoryMB = options.maxMemoryMB ?? this.defaultMaxMemoryMB;

    return new Promise<SandboxResult>((resolveResult) => {
      const worker = new Worker(WORKER_SANDBOX_BOOTSTRAP, {
        eval: true,
        workerData: { command: command.command },
        resourceLimits: { maxOldGenerationSizeMb: maxMemoryMB }
      });

      let settled = false;
      const settle = (result: SandboxResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().catch(() => undefined);
        resolveResult(result);
      };

      const timer = setTimeout(() => {
        settle({
          completed: false,
          reason: "timeout",
          message: `Worker exceeded timeout of ${timeoutMs}ms.`
        });
      }, timeoutMs);

      worker.on("message", (msg: { ok: boolean; stdout?: string; stderr?: string; durationMs: number }) => {
        if (msg.ok) {
          settle({
            completed: true,
            exitCode: 0,
            stdout: msg.stdout ?? "",
            stderr: "",
            durationMs: msg.durationMs
          });
        } else {
          settle({
            completed: true,
            exitCode: 1,
            stdout: "",
            stderr: msg.stderr ?? "Worker threw without a message.",
            durationMs: msg.durationMs
          });
        }
      });

      worker.on("error", (error: Error) => {
        settle({
          completed: true,
          exitCode: 1,
          stdout: "",
          stderr: error.message,
          durationMs: 0
        });
      });

      worker.on("exit", (code) => {
        // The "exit" event fires after terminate(); if we have not settled by
        // then it means the worker died without posting a message (e.g. memory
        // cap hit).
        if (code !== 0) {
          settle({
            completed: false,
            reason: "rejected",
            message: `Worker exited with code ${code} (likely memory cap or hard crash).`
          });
        }
      });
    });
  }
}

// ─── Phase 16b Step 3: DockerSandbox ───────────────────────────────────────────

export interface DockerSandboxOptions {
  /** Workspace root mounted into the container. */
  workspaceRoot: string;
  /** Container image. Default: node:lts-alpine. */
  image?: string;
  /** Default timeout when SandboxOptions.timeoutMs is not set. */
  defaultTimeoutMs?: number;
}

/**
 * DockerSandbox runs each command in an ephemeral container. The workspace
 * is mounted read-only by default; the timeout is wired through to the
 * underlying `docker run` invocation. `available()` returns true only when
 * the `docker` CLI is on PATH and the daemon responds — when Docker is not
 * installed the backend reports `available: false` and execute() resolves
 * to `{ completed: false, reason: "unavailable" }` so callers can degrade
 * gracefully.
 */
export class DockerSandbox implements SandboxBackend {
  readonly name = "docker" as const;
  private readonly workspaceRoot: string;
  private readonly image: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: DockerSandboxOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.image = options.image ?? "node:lts-alpine";
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  async available(): Promise<boolean> {
    return new Promise((resolveAvailable) => {
      exec("docker info --format '{{.ServerVersion}}'", { timeout: 2_000 }, (error) => {
        resolveAvailable(error === null);
      });
    });
  }

  async execute(command: SandboxCommand, options: SandboxOptions = {}): Promise<SandboxResult> {
    const available = await this.available();
    if (!available) {
      return {
        completed: false,
        reason: "unavailable",
        message: "Docker is not installed or its daemon is not reachable."
      };
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const networkFlag = options.network === "allow" ? "" : "--network none";
    // Mount workspace read-only by default. The cwd passed via options must be
    // inside the workspace (validated by the caller / WorkspaceSandbox-style
    // check is out of scope here — Docker's mount confines the visible tree).
    const escapedCommand = command.command.replace(/'/g, "'\\''");
    const dockerCmd = [
      "docker run --rm",
      networkFlag,
      `-v "${this.workspaceRoot}":/workspace:ro`,
      "-w /workspace",
      this.image,
      `sh -c '${escapedCommand}'`
    ]
      .filter((part) => part.length > 0)
      .join(" ");

    return new Promise<SandboxResult>((resolveResult) => {
      const start = Date.now();
      exec(dockerCmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (error?.killed === true) {
          resolveResult({ completed: false, reason: "timeout", message: `Container exceeded timeout of ${timeoutMs}ms.` });
          return;
        }
        const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolveResult({ completed: true, exitCode, stdout, stderr, durationMs });
      });
    });
  }
}

/**
 * INPUT: User config, project config, env overrides (VOLE_PROMPT_MODE, VOLE_EXECUTION_CONTRACT, VOLE_TOOL_PROFILE, VOLE_SANDBOX, VOLE_THINKING_BUDGET, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, and others), memory policy settings, and sessions directory resolution requests.
 * OUTPUT: EffectiveConfig (including ExecutionContract, toolProfile, sandboxed flag, and thinkingBudget), PromptMode, ThinkingBudget, redacted config views, ConfigValidationError, and resolveSessionsDirectory helper.
 * POS: Configuration boundary; keeps config loading separate from runtime behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const configPackageName = "@vole/config";

const openRouterDefaults = {
  baseURL: "https://openrouter.ai/api/v1"
} as const;

const anthropicDefaults = {
  model: "claude-haiku-4-5-20251001"
} as const;

export type AutonomyMode = "observe" | "confirm" | "auto";
export type TraceVerbosity = "explainable" | "debug";
export type LongTermMemoryFilePolicy = "disabled" | "read-only" | "write";
export type MemoryWritePolicy = "disabled";
export type PromptMode = "full" | "minimal" | "none";
export type ExecutionContract = "default" | "strict-agentic";
export type ToolProfileConfig = "coding" | "full" | "messaging" | "background";
export type ThinkingBudget = "off" | "minimal" | "low" | "medium" | "high" | "max" | "adaptive";

export interface EffectiveConfig {
  model: {
    provider: "openai-compatible" | "anthropic";
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
    thinkingBudget?: ThinkingBudget;
  };
  workspace: {
    root: string;
  };
  agents: {
    /** Default agent id when no `.vole/active-agent` file is present. */
    default?: string;
  };
  runtime: {
    defaultMode: AutonomyMode;
    maxSteps: number;
    promptMode?: PromptMode;
    executionContract?: ExecutionContract;
    toolProfile?: ToolProfileConfig;
    sandboxed?: boolean;
  };
  trace: {
    verbosity: TraceVerbosity;
  };
  tools: {
    fileSystem: boolean;
    shell: boolean;
    web: boolean;
  };
  permissions: {
    allowLowRisk: boolean;
  };
  sessions: {
    directory: string;
  };
  memory: {
    longTermFiles: LongTermMemoryFilePolicy;
    writes: MemoryWritePolicy;
  };
  secrets: {
    apiKey: string | undefined;
  };
}

export interface RedactedConfigView extends Omit<EffectiveConfig, "secrets"> {
  secrets: {
    apiKey: "configured" | "missing";
  };
}

export interface LoadConfigInput {
  userConfig?: unknown;
  projectConfig?: unknown;
  env?: Record<string, string | undefined>;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const defaultConfig: EffectiveConfig = {
  model: {
    provider: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    temperature: 0.2,
    maxTokens: 4096
  },
  workspace: {
    root: "."
  },
  agents: {},
  runtime: {
    defaultMode: "confirm",
    maxSteps: 12
  },
  trace: {
    verbosity: "explainable"
  },
  tools: {
    fileSystem: true,
    shell: true,
    web: false
  },
  permissions: {
    allowLowRisk: true
  },
  sessions: {
    directory: "~/.vole/sessions"
  },
  memory: {
    longTermFiles: "disabled",
    writes: "disabled"
  },
  secrets: {
    apiKey: undefined
  }
};

export function loadConfig(input: LoadConfigInput = {}): EffectiveConfig {
  const config = cloneConfig(defaultConfig);

  applyConfig(config, input.userConfig);
  applyConfig(config, input.projectConfig);
  applyEnv(config, input.env ?? {});
  validateConfig(config);

  return config;
}

export function redactedConfig(config: EffectiveConfig): RedactedConfigView {
  return {
    ...config,
    model: { ...config.model },
    workspace: { ...config.workspace },
    agents: { ...config.agents },
    runtime: { ...config.runtime },
    trace: { ...config.trace },
    tools: { ...config.tools },
    permissions: { ...config.permissions },
    sessions: { ...config.sessions },
    memory: { ...config.memory },
    secrets: {
      apiKey: config.secrets.apiKey === undefined ? "missing" : "configured"
    }
  };
}

function cloneConfig(config: EffectiveConfig): EffectiveConfig {
  return {
    model: { ...config.model },
    workspace: { ...config.workspace },
    agents: { ...config.agents },
    runtime: { ...config.runtime },
    trace: { ...config.trace },
    tools: { ...config.tools },
    permissions: { ...config.permissions },
    sessions: { ...config.sessions },
    memory: { ...config.memory },
    secrets: { ...config.secrets }
  };
}

function applyConfig(config: EffectiveConfig, value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    throw new ConfigValidationError("Configuration must be an object.");
  }

  applyObject(config.model, value.model);
  applyObject(config.workspace, value.workspace);
  applyObject(config.agents, value.agents);
  applyObject(config.runtime, value.runtime);
  applyObject(config.trace, value.trace);
  applyObject(config.tools, value.tools);
  applyObject(config.permissions, value.permissions);
  applyObject(config.sessions, value.sessions);
  applyObject(config.memory, value.memory);
}

function applyObject(target: Record<string, unknown>, value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    throw new ConfigValidationError("Configuration sections must be objects.");
  }

  for (const [key, sectionValue] of Object.entries(value)) {
    if (key in target) {
      target[key] = sectionValue;
    }
  }
}

function applyEnv(config: EffectiveConfig, env: Record<string, string | undefined>): void {
  if (env.OPENROUTER_API_KEY !== undefined) {
    config.model.provider = "openai-compatible";
    config.model.baseURL = openRouterDefaults.baseURL;
    config.model.model = "";
    config.secrets.apiKey = env.OPENROUTER_API_KEY;
  }

  if (env.ANTHROPIC_API_KEY !== undefined) {
    config.model.provider = "anthropic";
    config.model.model = anthropicDefaults.model;
    config.secrets.apiKey = env.ANTHROPIC_API_KEY;
  }

  if (env.VOLE_BASE_URL !== undefined) {
    config.model.baseURL = env.VOLE_BASE_URL;
  }
  if (env.VOLE_MODEL !== undefined) {
    config.model.model = env.VOLE_MODEL;
  }
  if (env.VOLE_DEFAULT_MODE !== undefined) {
    config.runtime.defaultMode = env.VOLE_DEFAULT_MODE as AutonomyMode;
  }
  if (env.VOLE_WORKSPACE_ROOT !== undefined) {
    config.workspace.root = env.VOLE_WORKSPACE_ROOT;
  }
  if (env.VOLE_AGENT !== undefined) {
    config.agents.default = env.VOLE_AGENT;
  }
  if (env.VOLE_LONG_TERM_MEMORY !== undefined) {
    config.memory.longTermFiles = env.VOLE_LONG_TERM_MEMORY as LongTermMemoryFilePolicy;
  }
  if (env.VOLE_API_KEY !== undefined) {
    config.secrets.apiKey = env.VOLE_API_KEY;
  }
  if (env.VOLE_PROMPT_MODE !== undefined) {
    config.runtime.promptMode = env.VOLE_PROMPT_MODE as PromptMode;
  }
  if (env.VOLE_EXECUTION_CONTRACT !== undefined) {
    config.runtime.executionContract = env.VOLE_EXECUTION_CONTRACT as ExecutionContract;
  }
  if (env.VOLE_TOOL_PROFILE !== undefined) {
    config.runtime.toolProfile = env.VOLE_TOOL_PROFILE as ToolProfileConfig;
  }
  if (env.VOLE_SANDBOX !== undefined) {
    config.runtime.sandboxed = env.VOLE_SANDBOX === "true";
  }
  if (env.VOLE_THINKING_BUDGET !== undefined) {
    config.model.thinkingBudget = env.VOLE_THINKING_BUDGET as ThinkingBudget;
  }
}

function validateConfig(config: EffectiveConfig): void {
  if (config.model.provider !== "openai-compatible" && config.model.provider !== "anthropic") {
    throw new ConfigValidationError(
      `Invalid model.provider "${String(config.model.provider)}". Expected openai-compatible or anthropic.`
    );
  }

  if (config.model.model.trim().length === 0) {
    throw new ConfigValidationError(
      "No model configured. Set VOLE_MODEL=<model-name> (e.g. VOLE_MODEL=openai/gpt-4o for OpenRouter)."
    );
  }

  if (!isAutonomyMode(config.runtime.defaultMode)) {
    throw new ConfigValidationError(
      `Invalid runtime.defaultMode "${String(config.runtime.defaultMode)}". Expected observe, confirm, or auto.`
    );
  }

  if (!isTraceVerbosity(config.trace.verbosity)) {
    throw new ConfigValidationError(
      `Invalid trace.verbosity "${String(config.trace.verbosity)}". Expected explainable or debug.`
    );
  }

  if (!isLongTermMemoryFilePolicy(config.memory.longTermFiles)) {
    throw new ConfigValidationError(
      `Invalid memory.longTermFiles "${String(config.memory.longTermFiles)}". Expected disabled or read-only.`
    );
  }

  if (config.memory.writes !== "disabled") {
    throw new ConfigValidationError(
      `Invalid memory.writes "${String(config.memory.writes)}". Only disabled is supported.`
    );
  }

  if (config.runtime.promptMode !== undefined && !isPromptMode(config.runtime.promptMode)) {
    throw new ConfigValidationError(
      `Invalid runtime.promptMode "${String(config.runtime.promptMode)}". Expected full, minimal, or none.`
    );
  }

  if (config.runtime.executionContract !== undefined && !isExecutionContract(config.runtime.executionContract)) {
    throw new ConfigValidationError(
      `Invalid runtime.executionContract "${String(config.runtime.executionContract)}". Expected default or strict-agentic.`
    );
  }

  if (config.runtime.toolProfile !== undefined && !isToolProfileConfig(config.runtime.toolProfile)) {
    throw new ConfigValidationError(
      `Invalid runtime.toolProfile "${String(config.runtime.toolProfile)}". Expected coding, full, messaging, or background.`
    );
  }

  if (config.model.thinkingBudget !== undefined && !isThinkingBudget(config.model.thinkingBudget)) {
    throw new ConfigValidationError(
      `Invalid model.thinkingBudget "${String(config.model.thinkingBudget)}". Expected off, minimal, low, medium, high, max, or adaptive.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === "observe" || value === "confirm" || value === "auto";
}

function isTraceVerbosity(value: unknown): value is TraceVerbosity {
  return value === "explainable" || value === "debug";
}

function isLongTermMemoryFilePolicy(value: unknown): value is LongTermMemoryFilePolicy {
  return value === "disabled" || value === "read-only" || value === "write";
}

function isPromptMode(value: unknown): value is PromptMode {
  return value === "full" || value === "minimal" || value === "none";
}

function isExecutionContract(value: unknown): value is ExecutionContract {
  return value === "default" || value === "strict-agentic";
}

function isToolProfileConfig(value: unknown): value is ToolProfileConfig {
  return value === "coding" || value === "full" || value === "messaging" || value === "background";
}

function isThinkingBudget(value: unknown): value is ThinkingBudget {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "max" ||
    value === "adaptive"
  );
}

/**
 * Resolves the sessions directory from the config, expanding `~/` to the HOME
 * directory from the provided env or process.env.HOME.
 *
 * Both CLI and Web adapters call this helper so they always point to the same
 * directory, making sessions created in one surface visible in the other.
 */
export function resolveSessionsDirectory(
  config: EffectiveConfig,
  env?: Record<string, string | undefined>
): string {
  const directory = config.sessions.directory;

  if (!directory.startsWith("~/")) {
    return directory;
  }

  const home = env?.HOME ?? process.env.HOME;

  return home === undefined ? directory : join(home, directory.slice(2));
}

// ─── Phase 15b Steps 2 + 3: per-agent identity ─────────────────────────────────

export interface AgentIdentity {
  /** Stable agent id; matches the directory name under `agents/`. */
  id: string;
  /** Absolute path of `<workspaceRoot>/agents/<id>/`. */
  root: string;
  /** Markdown bodies that exist for this agent. Missing files are simply omitted. */
  files: {
    agentsMd?: string;
    soulMd?: string;
    userMd?: string;
    memoryMd?: string;
    identityMd?: string;
    toolsMd?: string;
  };
}

const AGENT_IDENTITY_FILES = [
  ["AGENTS.md", "agentsMd"],
  ["SOUL.md", "soulMd"],
  ["USER.md", "userMd"],
  ["MEMORY.md", "memoryMd"],
  ["IDENTITY.md", "identityMd"],
  ["TOOLS.md", "toolsMd"]
] as const;

const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function isValidAgentId(id: string): boolean {
  return AGENT_ID_RE.test(id) && !id.startsWith(".");
}

/**
 * Scan `<workspaceRoot>/agents/` for sub-directories. Returns the alphabetized
 * list of valid agent ids. Hidden directories (starting with `.`) such as
 * `.archive` are excluded. Returns an empty list when the `agents/` directory
 * is missing.
 */
export function listAgentDirectories(workspaceRoot: string): string[] {
  const root = resolve(workspaceRoot, "agents");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => isValidAgentId(name))
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Resolve which agent should be active for a given workspace. Precedence:
 *   1. `<workspaceRoot>/.vole/active-agent` file (one line, agent id).
 *   2. `config.agents.default`.
 *   3. The first id returned by `listAgentDirectories(workspaceRoot)`.
 * Returns `undefined` when no agents exist.
 */
export function resolveActiveAgentId(workspaceRoot: string, config: EffectiveConfig): string | undefined {
  const activeFile = resolve(workspaceRoot, ".vole", "active-agent");
  try {
    const value = readFileSync(activeFile, "utf8").trim();
    if (value.length > 0 && isValidAgentId(value)) return value;
  } catch {
    // file missing — fall through
  }
  if (config.agents.default !== undefined && isValidAgentId(config.agents.default)) {
    return config.agents.default;
  }
  const all = listAgentDirectories(workspaceRoot);
  return all[0];
}

/**
 * Load the identity files for one agent. Throws when the agent directory does
 * not exist; missing markdown files are simply not present on the returned
 * record.
 */
export function loadAgentIdentity(workspaceRoot: string, agentId: string): AgentIdentity {
  if (!isValidAgentId(agentId)) {
    throw new ConfigValidationError(`Invalid agent id "${agentId}". Must match ${AGENT_ID_RE.source}.`);
  }
  const agentRoot = resolve(workspaceRoot, "agents", agentId);
  if (!existsSync(agentRoot)) {
    throw new ConfigValidationError(`Agent "${agentId}" not found at ${agentRoot}.`);
  }
  const files: AgentIdentity["files"] = {};
  for (const [filename, key] of AGENT_IDENTITY_FILES) {
    try {
      files[key] = readFileSync(join(agentRoot, filename), "utf8");
    } catch {
      // missing — skip
    }
  }
  return { id: agentId, root: agentRoot, files };
}

/**
 * Create `<workspaceRoot>/agents/<id>/` and seed empty markdown stubs. Refuses
 * to overwrite an existing agent directory. Returns the agent root path.
 */
export function createAgentDirectory(workspaceRoot: string, agentId: string): string {
  if (!isValidAgentId(agentId)) {
    throw new ConfigValidationError(`Invalid agent id "${agentId}". Must match ${AGENT_ID_RE.source}.`);
  }
  const agentRoot = resolve(workspaceRoot, "agents", agentId);
  if (existsSync(agentRoot)) {
    throw new ConfigValidationError(`Agent "${agentId}" already exists at ${agentRoot}.`);
  }
  mkdirSync(agentRoot, { recursive: true });
  const banner = `# ${agentId}\n\n`;
  writeFileSync(join(agentRoot, "AGENTS.md"), `${banner}Project conventions and operating rules for this agent.\n`);
  writeFileSync(join(agentRoot, "SOUL.md"), `${banner}Persona, tone, and values for this agent.\n`);
  writeFileSync(join(agentRoot, "USER.md"), `${banner}Notes about the user that this agent should remember.\n`);
  writeFileSync(join(agentRoot, "MEMORY.md"), `${banner}Long-term consolidated memory for this agent.\n`);
  return agentRoot;
}

/** Write `<workspaceRoot>/.vole/active-agent` so subsequent runs use this id. */
export function setActiveAgentId(workspaceRoot: string, agentId: string): void {
  if (!isValidAgentId(agentId)) {
    throw new ConfigValidationError(`Invalid agent id "${agentId}".`);
  }
  const dir = resolve(workspaceRoot, ".vole");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "active-agent"), `${agentId}\n`);
}

/**
 * Move `agents/<id>/` to `agents/.archive/<id>-<timestamp>/`. Refuses to remove
 * a missing agent. Returns the archive path.
 */
export function archiveAgentDirectory(workspaceRoot: string, agentId: string): string {
  if (!isValidAgentId(agentId)) {
    throw new ConfigValidationError(`Invalid agent id "${agentId}".`);
  }
  const agentRoot = resolve(workspaceRoot, "agents", agentId);
  if (!existsSync(agentRoot)) {
    throw new ConfigValidationError(`Agent "${agentId}" not found at ${agentRoot}.`);
  }
  const archiveBase = resolve(workspaceRoot, "agents", ".archive");
  mkdirSync(archiveBase, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = join(archiveBase, `${agentId}-${timestamp}`);
  renameSync(agentRoot, archivePath);
  return archivePath;
}

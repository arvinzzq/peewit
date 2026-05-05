/**
 * INPUT: User config, project config, env overrides (ARVINCLAW_PROMPT_MODE, ARVINCLAW_EXECUTION_CONTRACT, ARVINCLAW_TOOL_PROFILE, ARVINCLAW_SANDBOX, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, and others), memory policy settings, and sessions directory resolution requests.
 * OUTPUT: EffectiveConfig (including ExecutionContract, toolProfile, and sandboxed flag), PromptMode, redacted config views, ConfigValidationError, and resolveSessionsDirectory helper.
 * POS: Configuration boundary; keeps config loading separate from runtime behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { join } from "node:path";

export const configPackageName = "@arvinclaw/config";

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

export interface EffectiveConfig {
  model: {
    provider: "openai-compatible" | "anthropic";
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  workspace: {
    root: string;
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
    directory: "~/.arvinclaw/sessions"
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

  if (env.ARVINCLAW_BASE_URL !== undefined) {
    config.model.baseURL = env.ARVINCLAW_BASE_URL;
  }
  if (env.ARVINCLAW_MODEL !== undefined) {
    config.model.model = env.ARVINCLAW_MODEL;
  }
  if (env.ARVINCLAW_DEFAULT_MODE !== undefined) {
    config.runtime.defaultMode = env.ARVINCLAW_DEFAULT_MODE as AutonomyMode;
  }
  if (env.ARVINCLAW_WORKSPACE_ROOT !== undefined) {
    config.workspace.root = env.ARVINCLAW_WORKSPACE_ROOT;
  }
  if (env.ARVINCLAW_LONG_TERM_MEMORY !== undefined) {
    config.memory.longTermFiles = env.ARVINCLAW_LONG_TERM_MEMORY as LongTermMemoryFilePolicy;
  }
  if (env.ARVINCLAW_API_KEY !== undefined) {
    config.secrets.apiKey = env.ARVINCLAW_API_KEY;
  }
  if (env.ARVINCLAW_PROMPT_MODE !== undefined) {
    config.runtime.promptMode = env.ARVINCLAW_PROMPT_MODE as PromptMode;
  }
  if (env.ARVINCLAW_EXECUTION_CONTRACT !== undefined) {
    config.runtime.executionContract = env.ARVINCLAW_EXECUTION_CONTRACT as ExecutionContract;
  }
  if (env.ARVINCLAW_TOOL_PROFILE !== undefined) {
    config.runtime.toolProfile = env.ARVINCLAW_TOOL_PROFILE as ToolProfileConfig;
  }
  if (env.ARVINCLAW_SANDBOX !== undefined) {
    config.runtime.sandboxed = env.ARVINCLAW_SANDBOX === "true";
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
      "No model configured. Set ARVINCLAW_MODEL=<model-name> (e.g. ARVINCLAW_MODEL=openai/gpt-4o for OpenRouter)."
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

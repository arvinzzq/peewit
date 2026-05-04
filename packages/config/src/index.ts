/**
 * INPUT: User config, project config, ArvinClaw env overrides, memory policy settings, provider-specific env shortcuts (OPENROUTER_API_KEY, ANTHROPIC_API_KEY), and model provider selection.
 * OUTPUT: EffectiveConfig with provider selection (openai-compatible or anthropic), memory policy, redacted config views, and validation errors.
 * POS: Configuration boundary; keeps config loading separate from runtime behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
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

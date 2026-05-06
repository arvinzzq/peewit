/**
 * INPUT: None — this package exports pure type definitions and constants.
 * OUTPUT: AdapterCapabilities interface, AdapterStorageType type, canonical capability constants (CLI_CAPABILITIES, WEB_CAPABILITIES, BACKGROUND_CAPABILITIES), ToolProfile type, ToolProfileDefinition interface, TOOL_PROFILES record, and filterToolsByProfile function.
 * POS: Adapter capability boundary; declares what each surface can do so the runtime and future gateway can route correctly. Also provides tool profile filtering so adapters can restrict tool sets by use case.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */

export const adaptersPackageName = "@peewit/adapters";

/**
 * AdapterStorageType describes the storage backend an adapter uses for sessions.
 * Adapters do not choose their storage at runtime — the entrypoint configures
 * and injects a SessionStore. This type is used in configuration and documentation.
 */
export type AdapterStorageType = "in-memory" | "jsonl" | "sqlite";

/**
 * AdapterCapabilities declares what interaction modes an adapter supports.
 *
 * - streaming: adapter can display token_delta events (live streaming output)
 * - approvalPrompts: adapter can show interactive approval UI (modal, readline)
 * - background: adapter can run without a live user connection
 */
export interface AdapterCapabilities {
  streaming: boolean;
  approvalPrompts: boolean;
  background: boolean;
}

/**
 * CLI adapter capabilities.
 * The terminal adapter supports streaming output and interactive approval prompts.
 * It requires a live terminal session — it cannot run in the background.
 */
export const CLI_CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvalPrompts: true,
  background: false
};

/**
 * Web adapter capabilities.
 * The browser-based adapter supports SSE streaming and modal approval prompts.
 * It requires an active browser connection — it cannot run in the background.
 */
export const WEB_CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvalPrompts: true,
  background: false
};

/**
 * Background adapter capabilities.
 * A background task runs without a live user connection and cannot show
 * streaming output or approval prompts. Used for scheduled and event-triggered tasks (Phase 8+).
 */
export const BACKGROUND_CAPABILITIES: AdapterCapabilities = {
  streaming: false,
  approvalPrompts: false,
  background: true
};

/**
 * ToolProfile identifies a named tool set restriction for a session or task.
 * Each profile limits the agent to a purposeful subset of available tools.
 */
export type ToolProfile = "coding" | "full" | "messaging" | "background";

/**
 * ToolProfileDefinition describes a named tool profile and the tools it allows.
 * When allowedTools is empty the profile places no restriction (all tools are allowed).
 */
export interface ToolProfileDefinition {
  name: ToolProfile;
  description: string;
  allowedTools: string[];
}

/**
 * TOOL_PROFILES maps every supported ToolProfile to its definition.
 *
 * - full: All available tools (no restriction).
 * - coding: File system and shell tools for coding tasks.
 * - messaging: Read-only tools for informational tasks without file writes or shell execution.
 * - background: File system tools only for unattended background tasks.
 */
export const TOOL_PROFILES: Record<ToolProfile, ToolProfileDefinition> = {
  full: {
    name: "full",
    description: "All available tools.",
    allowedTools: []
  },
  coding: {
    name: "coding",
    description: "File system, search, and shell tools for coding tasks.",
    allowedTools: ["read_file", "list_directory", "write_file", "edit_file", "append_file", "run_shell", "search_files", "load_skill", "update_todos", "spawn_subagent"]
  },
  messaging: {
    name: "messaging",
    description: "Read-only tools for informational tasks without file writes or shell execution.",
    allowedTools: ["read_file", "list_directory", "read_web_page", "memory_search", "memory_get", "load_skill", "update_todos"]
  },
  background: {
    name: "background",
    description: "File system tools only for unattended background tasks.",
    allowedTools: ["read_file", "list_directory", "write_file", "memory_search", "memory_get", "append_daily_memory", "update_todos", "spawn_subagent"]
  }
};

/**
 * filterToolsByProfile returns only the tools allowed by the given profile.
 * For the "full" profile (allowedTools is empty) every tool is returned unchanged.
 * The function is generic so callers preserve their concrete tool type.
 */
export function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfile
): T[] {
  const def = TOOL_PROFILES[profile];
  if (def.allowedTools.length === 0) return tools;
  return tools.filter((t) => def.allowedTools.includes(t.name));
}

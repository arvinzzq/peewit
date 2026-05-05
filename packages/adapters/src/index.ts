/**
 * INPUT: None — this package exports pure type definitions and constants.
 * OUTPUT: AdapterCapabilities interface, AdapterStorageType type, and canonical capability constants (CLI_CAPABILITIES, WEB_CAPABILITIES, BACKGROUND_CAPABILITIES).
 * POS: Adapter capability boundary; declares what each surface can do so the runtime and future gateway can route correctly.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */

export const adaptersPackageName = "@arvinclaw/adapters";

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

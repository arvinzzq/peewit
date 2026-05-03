/**
 * INPUT: Tool definitions, input schemas, risk metadata, and registration requests.
 * OUTPUT: Tool contracts, registry lookup/listing behavior, and registry errors.
 * POS: Tool system layer; exposes capabilities without making permission decisions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
export const toolsPackageName = "@arvinclaw/tools";

export type ToolRiskLevel = "low" | "medium" | "high" | "blocked";

export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  risk: ToolRiskLevel;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
}

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export class InMemoryToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.#tools.has(tool.name)) {
      throw new ToolRegistryError(`Tool "${tool.name}" is already registered.`);
    }

    this.#tools.set(tool.name, cloneToolDefinition(tool));
  }

  get(name: string): ToolDefinition | undefined {
    const tool = this.#tools.get(name);

    return tool === undefined ? undefined : cloneToolDefinition(tool);
  }

  list(): ToolDefinition[] {
    return [...this.#tools.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => cloneToolDefinition(tool));
  }
}

function cloneToolDefinition(tool: ToolDefinition): ToolDefinition {
  return structuredClone(tool);
}

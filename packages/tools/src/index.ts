/**
 * INPUT: Tool definitions, input schemas, risk metadata, registration requests, tool execution input, and workspace file system access.
 * OUTPUT: Tool contracts, registry lookup/listing behavior, executable read-only file tools, normalized tool results, and registry errors.
 * POS: Tool system layer; exposes capabilities without making permission decisions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

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

export interface ToolExecutionContext {
  workspaceRoot: string;
}

export interface ToolExecutionError {
  code: string;
  message: string;
}

export interface ToolExecutionFailure {
  ok: false;
  error: ToolExecutionError;
}

export interface ReadFileToolResult {
  ok: true;
  content: string;
  summary: string;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
}

export interface ListDirectoryToolResult {
  ok: true;
  entries: DirectoryEntry[];
  summary: string;
}

export type ToolExecutionResult = ReadFileToolResult | ListDirectoryToolResult | ToolExecutionFailure;

export interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
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

export function createReadFileTool(): ExecutableTool {
  return {
    name: "read_file",
    description: "Read a UTF-8 file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string"
        }
      },
      required: ["path"]
    },
    risk: "low",
    async execute(input, context) {
      const path = getPathInput(input);
      if (path === undefined) {
        return inputError("Tool input must include a string path.");
      }

      const target = resolveWorkspacePath(context.workspaceRoot, path);
      if (target === undefined) {
        return outsideWorkspaceError();
      }

      try {
        return {
          ok: true,
          content: await readFile(target.absolutePath, "utf8"),
          summary: `Read file ${target.displayPath}.`
        };
      } catch (error) {
        return fileSystemError(error);
      }
    }
  };
}

export function createListDirectoryTool(): ExecutableTool {
  return {
    name: "list_directory",
    description: "List entries in a workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string"
        }
      },
      required: ["path"]
    },
    risk: "low",
    async execute(input, context) {
      const path = getPathInput(input);
      if (path === undefined) {
        return inputError("Tool input must include a string path.");
      }

      const target = resolveWorkspacePath(context.workspaceRoot, path);
      if (target === undefined) {
        return outsideWorkspaceError();
      }

      try {
        const entries = await readdir(target.absolutePath, { withFileTypes: true });

        return {
          ok: true,
          entries: entries
            .map<DirectoryEntry>((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          summary: `Listed directory ${target.displayPath}.`
        };
      } catch (error) {
        return fileSystemError(error);
      }
    }
  };
}

function getPathInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return undefined;
  }

  const path = (input as { path?: unknown }).path;

  return typeof path === "string" ? path : undefined;
}

function resolveWorkspacePath(workspaceRoot: string, path: string): { absolutePath: string; displayPath: string } | undefined {
  const root = resolve(workspaceRoot);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);

  if (relativePath.startsWith("..") || relativePath === ".." || absolutePath !== root && relativePath === "") {
    return undefined;
  }

  return {
    absolutePath,
    displayPath: relativePath === "" ? "." : relativePath
  };
}

function inputError(message: string): ToolExecutionFailure {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message
    }
  };
}

function outsideWorkspaceError(): ToolExecutionFailure {
  return {
    ok: false,
    error: {
      code: "path_outside_workspace",
      message: "Tool path must stay inside the workspace."
    }
  };
}

function fileSystemError(error: unknown): ToolExecutionFailure {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "fs_error";

  return {
    ok: false,
    error: {
      code,
      message: "File system operation failed."
    }
  };
}

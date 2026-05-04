/**
 * INPUT: Tool definitions, input schemas, risk metadata, registration requests, tool execution input, and workspace file system access.
 * OUTPUT: Tool contracts, registry lookup/listing behavior, executable read-only file tools, guarded write_file tool, guarded shell tool, read_web_page tool, update_todos task tracker, normalized tool results, and registry errors.
 * POS: Tool system layer; exposes capabilities without making permission decisions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { exec } from "node:child_process";
import { readdir, readFile, writeFile as writeFileFs, mkdir } from "node:fs/promises";
import { resolve, relative, basename, extname, dirname } from "node:path";

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

export interface WriteFileToolResult {
  ok: true;
  summary: string;
}

export interface ShellToolResult {
  ok: true;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  summary: string;
}

export interface ReadWebPageToolResult {
  ok: true;
  url: string;
  content: string;
  summary: string;
}

export interface UpdateTodosResult {
  ok: true;
}

export type ToolExecutionResult =
  | ReadFileToolResult
  | ListDirectoryToolResult
  | WriteFileToolResult
  | ShellToolResult
  | ReadWebPageToolResult
  | UpdateTodosResult
  | ToolExecutionFailure;

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export type WebFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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

      if (isSecretLikePath(target.absolutePath)) {
        return secretFileError();
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

function isSecretLikePath(absolutePath: string): boolean {
  const name = basename(absolutePath).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name === ".netrc") return true;
  const ext = extname(name);
  if (ext === ".key" || ext === ".pem" || ext === ".p12" || ext === ".pfx") return true;
  return name === "id_rsa" || name === "id_ed25519" || name === "id_ecdsa" || name === "id_dsa";
}

function secretFileError(): ToolExecutionFailure {
  return {
    ok: false,
    error: {
      code: "path_not_permitted",
      message: "Tool path is not permitted."
    }
  };
}

function getWriteInput(input: unknown): { path: string; content: string } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as { path?: unknown }).path;
  const content = (input as { content?: unknown }).content;
  return typeof path === "string" && typeof content === "string" ? { path, content } : undefined;
}

const SHELL_DEFAULT_TIMEOUT_MS = 30_000;
const SHELL_MAX_OUTPUT_CHARS = 4_000;

const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*.*\s+\/\s*$/, // rm -r* targeting root /
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*.*\s+~\/?$/, // rm -r* targeting home ~
  /:\(\)\s*\{/, // fork bomb
  /[|>]\s*\/dev\/(sd|hd|nvme|vd)[a-z0-9]?/, // write/pipe to block devices
  /\b(mkfs(\.[a-z0-9]+)?|fdisk|parted|shred)\b/, // disk tools
];

function isBlockedCommand(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function truncateShellOutput(output: string): string {
  if (output.length <= SHELL_MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, SHELL_MAX_OUTPUT_CHARS)}\n[truncated ${output.length - SHELL_MAX_OUTPUT_CHARS} characters]`;
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ completed: true; exitCode: number; stdout: string; stderr: string; durationMs: number } | { completed: false }> {
  return new Promise((resolve) => {
    const start = Date.now();
    exec(command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      if (error?.killed === true) {
        resolve({ completed: false });
        return;
      }
      const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({
        completed: true,
        exitCode,
        stdout: truncateShellOutput(stdout),
        stderr: truncateShellOutput(stderr),
        durationMs
      });
    });
  });
}

function getShellInput(input: unknown): { command: string; timeoutMs?: number } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as { command?: unknown }).command;
  if (typeof command !== "string") return undefined;
  const timeoutMs = (input as { timeoutMs?: unknown }).timeoutMs;
  return { command, ...(typeof timeoutMs === "number" ? { timeoutMs } : {}) };
}

function blockedCommandError(): ToolExecutionFailure {
  return {
    ok: false,
    error: {
      code: "command_blocked",
      message: "Command matches a blocked pattern."
    }
  };
}

export function createShellTool(): ExecutableTool {
  return {
    name: "run_shell",
    description: "Run a shell command in the workspace directory. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" }
      },
      required: ["command"]
    },
    risk: "high",
    async execute(input, context) {
      const parsed = getShellInput(input);
      if (parsed === undefined) {
        return inputError("Tool input must include a string command.");
      }

      if (isBlockedCommand(parsed.command)) {
        return blockedCommandError();
      }

      const timeoutMs = parsed.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS;
      const result = await runShellCommand(parsed.command, context.workspaceRoot, timeoutMs);

      if (!result.completed) {
        return {
          ok: false,
          error: {
            code: "timeout",
            message: `Command exceeded ${timeoutMs}ms timeout.`
          }
        };
      }

      return {
        ok: true,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        summary: `Ran command in ${result.durationMs}ms with exit code ${result.exitCode}.`
      };
    }
  };
}

export function createWriteFileTool(): ExecutableTool {
  return {
    name: "write_file",
    description: "Write or overwrite a UTF-8 file inside the workspace. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    },
    risk: "medium",
    async execute(input, context) {
      const parsed = getWriteInput(input);
      if (parsed === undefined) {
        return inputError("Tool input must include a string path and string content.");
      }

      const target = resolveWorkspacePath(context.workspaceRoot, parsed.path);
      if (target === undefined) {
        return outsideWorkspaceError();
      }

      if (isSecretLikePath(target.absolutePath)) {
        return secretFileError();
      }

      try {
        await mkdir(dirname(target.absolutePath), { recursive: true });
        await writeFileFs(target.absolutePath, parsed.content, "utf8");
        return {
          ok: true,
          summary: `Wrote file ${target.displayPath}.`
        };
      } catch (error) {
        return fileSystemError(error);
      }
    }
  };
}

const WEB_PAGE_MAX_CHARS = 8_000;

function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateWebContent(content: string): string {
  if (content.length <= WEB_PAGE_MAX_CHARS) return content;
  return `${content.slice(0, WEB_PAGE_MAX_CHARS)}\n[truncated ${content.length - WEB_PAGE_MAX_CHARS} characters]`;
}

function getUrlInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const url = (input as { url?: unknown }).url;
  return typeof url === "string" ? url : undefined;
}

export function createReadWebPageTool(fetchFn: WebFetchLike = fetch): ExecutableTool {
  return {
    name: "read_web_page",
    description: "Read a public web page and return its text content.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" }
      },
      required: ["url"]
    },
    risk: "low",
    async execute(input, _context) {
      const url = getUrlInput(input);
      if (url === undefined) {
        return inputError("Tool input must include a string url.");
      }

      const parsed = parseHttpUrl(url);
      if (parsed === undefined) {
        return inputError("Tool url must use http or https.");
      }

      try {
        const response = await fetchFn(url);

        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: "http_error",
              message: `Page request failed with status ${response.status}.`
            }
          };
        }

        const html = await response.text();
        const content = truncateWebContent(extractTextFromHtml(html));

        return {
          ok: true,
          url,
          content,
          summary: `Read web page ${parsed.hostname}.`
        };
      } catch {
        return {
          ok: false,
          error: {
            code: "network_error",
            message: "Web page request failed."
          }
        };
      }
    }
  };
}

export function createUpdateTodosTool(onUpdate?: (todos: TodoItem[]) => void): ExecutableTool {
  return {
    name: "update_todos",
    description: "Update the task list to track progress on multi-step work. Call this when starting a complex task or after completing each step. At most one item may be in_progress at a time.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] }
            },
            required: ["content", "status"]
          }
        }
      },
      required: ["todos"]
    },
    risk: "low",
    async execute(input, _context): Promise<UpdateTodosResult | ToolExecutionFailure> {
      const raw = input as { todos?: unknown };
      if (!Array.isArray(raw.todos)) {
        return { ok: false, error: { code: "invalid_input", message: "todos must be an array." } };
      }

      const todos: TodoItem[] = [];
      for (const item of raw.todos) {
        if (typeof item !== "object" || item === null) {
          return { ok: false, error: { code: "invalid_input", message: "Each todo must be an object." } };
        }
        const { content, status } = item as { content?: unknown; status?: unknown };
        if (typeof content !== "string" || content.length === 0) {
          return { ok: false, error: { code: "invalid_input", message: "Each todo must have a non-empty content string." } };
        }
        if (status !== "pending" && status !== "in_progress" && status !== "completed") {
          return { ok: false, error: { code: "invalid_input", message: `Invalid status "${String(status)}". Must be pending, in_progress, or completed.` } };
        }
        todos.push({ content, status });
      }

      const inProgressCount = todos.filter((t) => t.status === "in_progress").length;
      if (inProgressCount > 1) {
        return { ok: false, error: { code: "invalid_input", message: "At most one todo may be in_progress at a time." } };
      }

      onUpdate?.(todos);
      return { ok: true };
    }
  };
}

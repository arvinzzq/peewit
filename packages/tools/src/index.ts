/**
 * INPUT: Tool definitions, schemas, workspace FS access, skill file map, ShellToolOptions.
 * OUTPUT: Tool contracts, registry, built-in tools (file, edit_file, append_file, shell with sandbox,
 *   web, memory, todos, skills, search_files), ShellToolOptions, SkillFileMap, result types, registry errors.
 * POS: Tool system layer; exposes capabilities without making permission decisions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { exec } from "node:child_process";
import { access, readdir, readFile, stat as statFs, writeFile as writeFileFs, mkdir } from "node:fs/promises";
import { resolve, relative, basename, extname, dirname, join } from "node:path";

export const toolsPackageName = "@vole/tools";

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
  /** Phase 12: parent runtime's recent messages, passed by AgentRuntime so spawn tools can fork the transcript into a child session. */
  parentRecentMessages?: ReadonlyArray<{ role: string; content: string | null }>;
  /** Phase 12: parent session id; used by spawn tools to compose child session keys. */
  parentSessionId?: string;
  /** Phase 12: current spawn depth — 0 for top-level user runs, parent depth + 1 for spawned children. */
  depth?: number;
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

export interface UpdateHeartbeatResult {
  ok: true;
  filePath: string;
}

export interface AppendDailyMemoryResult {
  ok: true;
  filePath: string;
  summary: string;
}

export interface SpawnSubagentResult {
  type: "spawn_subagent_result";
  ok: boolean;
  result?: string;
  error?: string;
}

export interface SpawnSubagentAsyncResult {
  type: "spawn_subagent_async_result";
  taskId: string;
  status: string;
}

export interface CheckSubagentResult {
  type: "check_subagent_result";
  taskId: string;
  status: string;
  result?: string | undefined;
}

export interface LoadSkillResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/**
 * Map of skill name → skill body. The body is the post-frontmatter content
 * returned by `parseSKILLMd`, already loaded into memory by SkillLoader. The
 * load_skill tool reads from this map directly, so it works equally well for
 * built-in skills (body inlined in the SkillDefinition) and disk-loaded skills
 * (body read from SKILL.md at load time).
 */
export type SkillBodyMap = Map<string, string>;

/** @deprecated Renamed to `SkillBodyMap` — the map's value is now the skill body, not its file path. Kept as an alias for one minor release. */
export type SkillFileMap = SkillBodyMap;

export interface MemorySearchResult {
  ok: true;
  results: Array<{ file: string; excerpt: string }>;
  total: number;
}

export interface MemoryGetResult {
  ok: true;
  content?: string;
  error?: string;
}

export interface EditFileResult {
  ok: true;
  path: string;
  replacements: number;
  summary: string;
}

export interface AppendFileResult {
  ok: true;
  path: string;
  summary: string;
}

export interface SearchFilesMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchFilesResult {
  type: "search_files_result";
  matches: SearchFilesMatch[];
  truncated: boolean;
  matchedFiles: number;
  searchedFiles: number;
}

export type ToolExecutionResult =
  | ReadFileToolResult
  | ListDirectoryToolResult
  | WriteFileToolResult
  | ShellToolResult
  | ReadWebPageToolResult
  | UpdateTodosResult
  | UpdateHeartbeatResult
  | AppendDailyMemoryResult
  | SpawnSubagentResult
  | SpawnSubagentAsyncResult
  | CheckSubagentResult
  | LoadSkillResult
  | MemorySearchResult
  | MemoryGetResult
  | SearchFilesResult
  | EditFileResult
  | AppendFileResult
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

function sandboxRejectionError(): ToolExecutionFailure {
  return {
    ok: false,
    error: {
      code: "sandbox_rejected",
      message: "Command rejected: workspace sandbox prevents execution outside workspace."
    }
  };
}

/**
 * SANDBOX_ESCAPE_PATTERNS is a heuristic list of patterns that attempt to escape
 * the workspace when sandboxed mode is enabled.
 *
 * - `/../` — path traversal in arguments
 * - `cd /` followed by space or end-of-string — change to an absolute path root
 * - `cd ~/` or `cd ~` followed by space or end-of-string — change to the home directory
 */
const SANDBOX_ESCAPE_PATTERNS: RegExp[] = [
  /\/\.\.\//,                  // /../ path traversal
  /\bcd\s+\/(\s|$)/,           // cd / or cd /... (absolute root)
  /\bcd\s+~\/?(\s|$)/          // cd ~ or cd ~/...
];

function isSandboxEscape(command: string): boolean {
  return SANDBOX_ESCAPE_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * ShellToolOptions controls optional safety features of the shell tool.
 */
export interface ShellToolOptions {
  /**
   * When true, commands that attempt to escape the workspace are rejected
   * before execution. The shell process always runs in context.workspaceRoot.
   */
  sandboxed?: boolean;
}

export function createShellTool(options?: ShellToolOptions): ExecutableTool {
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

      if (options?.sandboxed === true && isSandboxEscape(parsed.command)) {
        return sandboxRejectionError();
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

// ── edit_file ─────────────────────────────────────────────────────────────────

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
  return count;
}

export function createEditFileTool(): ExecutableTool {
  return {
    name: "edit_file",
    description:
      "Make a precise edit to an existing file by replacing an exact string. " +
      "old_string must appear exactly once in the file unless replace_all is true. " +
      "Prefer this over write_file when modifying existing content — it never loses surrounding code.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
        old_string: { type: "string", description: "The exact string to replace. Must be unique in the file." },
        new_string: { type: "string", description: "The replacement string." },
        replace_all: { type: "boolean", description: "Replace every occurrence. Default false (errors on multiple matches)." }
      },
      required: ["path", "old_string", "new_string"]
    },
    async execute(rawInput, context): Promise<EditFileResult | ToolExecutionFailure> {
      const input = rawInput as Record<string, unknown>;
      if (typeof input["path"] !== "string" || typeof input["old_string"] !== "string" || typeof input["new_string"] !== "string") {
        return inputError("path, old_string, and new_string must be strings.");
      }
      const filePath = input["path"];
      const oldStr = input["old_string"];
      const newStr = input["new_string"];
      const replaceAll = input["replace_all"] === true;
      if (oldStr.length === 0) return inputError("old_string must not be empty.");

      const abs = resolve(context.workspaceRoot, filePath);
      if (!abs.startsWith(resolve(context.workspaceRoot) + "/") && abs !== resolve(context.workspaceRoot)) {
        return outsideWorkspaceError();
      }
      if (isSecretLikePath(abs)) return secretFileError();

      let content: string;
      try {
        content = await readFile(abs, "utf8");
      } catch (err) {
        return fileSystemError(err);
      }

      const count = countOccurrences(content, oldStr);
      if (count === 0) {
        return { ok: false, error: { code: "string_not_found", message: `old_string not found in ${filePath}.` } };
      }
      if (count > 1 && !replaceAll) {
        return { ok: false, error: { code: "multiple_matches", message: `old_string appears ${count} times in ${filePath}. Use replace_all: true or add more surrounding context to make it unique.` } };
      }

      const newContent = content.split(oldStr).join(newStr);
      try {
        await writeFileFs(abs, newContent, "utf8");
      } catch (err) {
        return fileSystemError(err);
      }

      return { ok: true, path: filePath, replacements: count, summary: `Edited ${filePath}: ${count} replacement${count === 1 ? "" : "s"}.` };
    }
  };
}

// ── append_file ───────────────────────────────────────────────────────────────

export function createAppendFileTool(): ExecutableTool {
  return {
    name: "append_file",
    description:
      "Append text to the end of a file. Creates the file (and parent directories) if it does not exist. " +
      "Use this to add new code, tests, or entries without touching existing content.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
        content: { type: "string", description: "Text to append." }
      },
      required: ["path", "content"]
    },
    async execute(rawInput, context): Promise<AppendFileResult | ToolExecutionFailure> {
      const input = rawInput as Record<string, unknown>;
      if (typeof input["path"] !== "string" || typeof input["content"] !== "string") {
        return inputError("path and content must be strings.");
      }
      const filePath = input["path"];
      const text = input["content"];

      const abs = resolve(context.workspaceRoot, filePath);
      if (!abs.startsWith(resolve(context.workspaceRoot) + "/") && abs !== resolve(context.workspaceRoot)) {
        return outsideWorkspaceError();
      }
      if (isSecretLikePath(abs)) return secretFileError();

      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFileFs(abs, text, { flag: "a" });
      } catch (err) {
        return fileSystemError(err);
      }

      return { ok: true, path: filePath, summary: `Appended to ${filePath}.` };
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

export function createLoadSkillTool(skillBodyMap: SkillBodyMap): ExecutableTool {
  return {
    name: "load_skill",
    description: "Load the full instructions for a named skill. Call this when you need to follow a skill's detailed guidance. Available skills are listed in the <skills> section.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The exact skill name to load." }
      },
      required: ["name"]
    },
    async execute(rawInput): Promise<LoadSkillResult> {
      const { name } = rawInput as { name: string };
      const body = skillBodyMap.get(name);
      if (body === undefined) {
        return { ok: false, error: `Skill "${name}" not found. Check the skills list for available names.` };
      }
      return { ok: true, content: body };
    }
  };
}

// Memory tools (createMemorySearchTool, createMemoryGetTool, createAppendDailyMemoryTool)
// were moved to @vole/memory in Phase 13 Step 2. The result type interfaces
// (MemorySearchResult, MemoryGetResult, AppendDailyMemoryResult) stay here so the
// ToolExecutionResult discriminated union remains single-sourced.

// ── search_files ──────────────────────────────────────────────────────────────

const SEARCH_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".pnpm-store", ".nyc_output", ".turbo", ".cache",
]);
const SEARCH_BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".bin", ".dll", ".so", ".dylib", ".class",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".flac",
  ".db", ".sqlite", ".sqlite3",
]);
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_DEFAULT_MAX_RESULTS = 50;

async function* walkSearchFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSearchFiles(full);
    } else if (entry.isFile() && !SEARCH_BINARY_EXTS.has(extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

function matchesInclude(relPath: string, pattern: string): boolean {
  const base = basename(relPath);
  const hasPathSep = pattern.includes("/");
  const target = hasPathSep ? relPath.replace(/\\/g, "/") : base;
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regexStr}$`).test(target);
}

export function createUpdateHeartbeatTool(): ExecutableTool {
  return {
    name: "update_heartbeat",
    description: "Write current execution status to HEARTBEAT.md in the workspace. Use during long-running background tasks to signal progress and liveness. Status must be one of: running, completed, failed, idle.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["running", "completed", "failed", "idle"],
          description: "Current execution status."
        },
        message: {
          type: "string",
          description: "Human-readable progress note or status message."
        }
      },
      required: ["status", "message"]
    },
    async execute(rawInput, context): Promise<UpdateHeartbeatResult | ToolExecutionFailure> {
      const input = rawInput as { status?: unknown; message?: unknown };
      const validStatuses = ["running", "completed", "failed", "idle"] as const;
      const status = validStatuses.find((s) => s === input.status) ?? "running";
      const message = typeof input.message === "string" ? input.message.trim() : "";

      const filePath = resolve(context.workspaceRoot, "HEARTBEAT.md");
      const now = new Date().toISOString();
      const lines = [
        "# Heartbeat",
        "",
        `**Status**: ${status}`,
        `**Last updated**: ${now}`,
        ...(message.length > 0 ? ["", message] : []),
      ];

      try {
        await writeFileFs(filePath, lines.join("\n") + "\n");
        return { ok: true, filePath: "HEARTBEAT.md" };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to write HEARTBEAT.md.";
        return { ok: false, error: { code: "write_error", message: msg } };
      }
    }
  };
}

export function createSearchFilesTool(): ExecutableTool {
  return {
    name: "search_files",
    description:
      "Search for a text or regex pattern across files in the workspace. Returns matching file paths, line numbers, and line content. Skips node_modules, .git, dist, and binary files.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex pattern to search for."
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to workspace root. Defaults to '.' (workspace root)."
        },
        include: {
          type: "string",
          description: "Glob pattern to filter files, e.g. '*.ts' or '**/*.md'. Defaults to all non-binary files."
        },
        case_sensitive: {
          type: "boolean",
          description: "Case-sensitive search. Defaults to false."
        },
        max_results: {
          type: "number",
          description: `Maximum matching lines to return. Defaults to ${SEARCH_DEFAULT_MAX_RESULTS}.`
        }
      },
      required: ["pattern"]
    },
    async execute(rawInput, context): Promise<SearchFilesResult> {
      const input = rawInput as {
        pattern: string;
        path?: string;
        include?: string;
        case_sensitive?: boolean;
        max_results?: number;
      };

      const root = context.workspaceRoot;
      const searchDir = input.path ? resolve(root, input.path) : root;
      const maxResults = input.max_results ?? SEARCH_DEFAULT_MAX_RESULTS;
      const flags = input.case_sensitive === true ? "" : "i";

      let regex: RegExp;
      try {
        regex = new RegExp(input.pattern, flags);
      } catch {
        const escaped = input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, flags);
      }

      const matches: SearchFilesMatch[] = [];
      let searchedFiles = 0;
      let matchedFiles = 0;
      let truncated = false;

      outer: for await (const filePath of walkSearchFiles(searchDir)) {
        const relPath = relative(root, filePath).replace(/\\/g, "/");
        if (input.include !== undefined && !matchesInclude(relPath, input.include)) continue;

        let text: string;
        try {
          const s = await statFs(filePath);
          if (s.size > SEARCH_MAX_FILE_BYTES) continue;
          text = await readFile(filePath, "utf8");
        } catch { continue; }

        searchedFiles++;
        const lines = text.split("\n");
        let hit = false;
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            if (matches.length >= maxResults) { truncated = true; break outer; }
            matches.push({ file: relPath, line: i + 1, content: lines[i]!.trimEnd() });
            hit = true;
          }
          regex.lastIndex = 0;
        }
        if (hit) matchedFiles++;
      }

      return { type: "search_files_result", matches, truncated, matchedFiles, searchedFiles };
    }
  };
}

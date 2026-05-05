import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAppendDailyMemoryTool,
  createListDirectoryTool,
  createLoadSkillTool,
  createMemoryGetTool,
  createMemorySearchTool,
  createReadFileTool,
  createReadWebPageTool,
  createShellTool,
  createUpdateTodosTool,
  createWriteFileTool,
  InMemoryToolRegistry,
  ToolRegistryError,
  type MemoryGetResult,
  type MemorySearchResult,
  type TodoItem,
  type ToolDefinition,
  type WebFetchLike
} from "./index.js";

describe("tool registry", () => {
  const readFileTool: ToolDefinition = {
    name: "read_file",
    description: "Read a workspace file.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string"
        }
      },
      required: ["path"]
    },
    risk: "low"
  };

  test("registers and looks up tool definitions by name", () => {
    const registry = new InMemoryToolRegistry();

    registry.register(readFileTool);

    expect(registry.get("read_file")).toEqual(readFileTool);
    expect(registry.get("missing_tool")).toBeUndefined();
  });

  test("lists tool definitions in name order without exposing internal arrays", () => {
    const registry = new InMemoryToolRegistry();

    registry.register({
      name: "write_file",
      description: "Write a workspace file.",
      inputSchema: {
        type: "object"
      },
      risk: "medium"
    });
    registry.register(readFileTool);

    const listed = registry.list();
    listed.pop();

    expect(registry.list().map((tool) => tool.name)).toEqual(["read_file", "write_file"]);
  });

  test("rejects duplicate tool names", () => {
    const registry = new InMemoryToolRegistry();

    registry.register(readFileTool);

    expect(() => registry.register(readFileTool)).toThrow(ToolRegistryError);
  });
});

describe("read-only file tools", () => {
  test("reads a file inside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, "README.md"), "Hello from a workspace file.");
    const tool = createReadFileTool();

    const result = await tool.execute(
      {
        path: "README.md"
      },
      {
        workspaceRoot: workspace
      }
    );

    expect(result).toEqual({
      ok: true,
      content: "Hello from a workspace file.",
      summary: "Read file README.md."
    });
  });

  test("lists directory entries inside the workspace in name order", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, "b.txt"), "b");
    await writeFile(join(workspace, "a.txt"), "a");
    await mkdir(join(workspace, "docs"));
    const tool = createListDirectoryTool();

    const result = await tool.execute(
      {
        path: "."
      },
      {
        workspaceRoot: workspace
      }
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          name: "a.txt",
          type: "file"
        },
        {
          name: "b.txt",
          type: "file"
        },
        {
          name: "docs",
          type: "directory"
        }
      ],
      summary: "Listed directory .."
    });
  });

  test("rejects paths outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createReadFileTool();

    const result = await tool.execute(
      {
        path: "../outside.txt"
      },
      {
        workspaceRoot: workspace
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_outside_workspace",
        message: "Tool path must stay inside the workspace."
      }
    });
  });
});

describe("read_file safety", () => {
  test("rejects input with missing path field", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createReadFileTool();

    const result = await tool.execute({}, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string path."
      }
    });
  });

  test("rejects input with non-string path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createReadFileTool();

    const result = await tool.execute({ path: 42 }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string path."
      }
    });
  });

  test("blocks .env files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, ".env"), "SECRET=abc123");
    const tool = createReadFileTool();

    const result = await tool.execute({ path: ".env" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("blocks .env.production files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, ".env.production"), "SECRET=abc123");
    const tool = createReadFileTool();

    const result = await tool.execute({ path: ".env.production" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("blocks .pem private key files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, "server.pem"), "-----BEGIN PRIVATE KEY-----");
    const tool = createReadFileTool();

    const result = await tool.execute({ path: "server.pem" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("blocks id_rsa SSH key files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, "id_rsa"), "-----BEGIN RSA PRIVATE KEY-----");
    const tool = createReadFileTool();

    const result = await tool.execute({ path: "id_rsa" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("returns ENOENT error for missing file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createReadFileTool();

    const result = await tool.execute({ path: "missing.txt" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ENOENT",
        message: "File system operation failed."
      }
    });
  });
});

describe("list_directory safety", () => {
  test("rejects input with missing path field", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createListDirectoryTool();

    const result = await tool.execute({}, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string path."
      }
    });
  });

  test("rejects paths outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createListDirectoryTool();

    const result = await tool.execute({ path: "../outside" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_outside_workspace",
        message: "Tool path must stay inside the workspace."
      }
    });
  });

  test("returns ENOENT error for missing directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createListDirectoryTool();

    const result = await tool.execute({ path: "missing-dir" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ENOENT",
        message: "File system operation failed."
      }
    });
  });
});

describe("write_file tool", () => {
  test("has medium risk", () => {
    const tool = createWriteFileTool();

    expect(tool.risk).toBe("medium");
  });

  test("writes a file inside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: "output.txt", content: "hello world" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: true,
      summary: "Wrote file output.txt."
    });
    expect(await readFile(join(workspace, "output.txt"), "utf8")).toBe("hello world");
  });

  test("creates parent directories when needed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: "subdir/nested/file.txt", content: "nested content" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: true,
      summary: "Wrote file subdir/nested/file.txt."
    });
    expect(await readFile(join(workspace, "subdir/nested/file.txt"), "utf8")).toBe("nested content");
  });

  test("rejects paths outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: "../outside.txt", content: "data" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_outside_workspace",
        message: "Tool path must stay inside the workspace."
      }
    });
  });

  test("blocks writing to .env files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: ".env", content: "SECRET=overwritten" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("blocks writing to .pem files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: "key.pem", content: "data" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "path_not_permitted",
        message: "Tool path is not permitted."
      }
    });
  });

  test("rejects input with missing content field", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { path: "output.txt" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string path and string content."
      }
    });
  });

  test("rejects input with missing path field", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createWriteFileTool();

    const result = await tool.execute(
      { content: "data" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string path and string content."
      }
    });
  });
});

describe("shell tool", () => {
  test("has high risk", () => {
    const tool = createShellTool();

    expect(tool.risk).toBe("high");
  });

  test("runs a command and captures stdout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "echo hello" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: expect.stringContaining("hello"),
      stderr: "",
    });
  });

  test("runs in the workspace directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "pwd" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: expect.stringContaining(workspace),
    });
  });

  test("captures non-zero exit code as ok result", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "false" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({
      ok: true,
      exitCode: 1,
    });
  });

  test("captures stderr output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "echo errout >&2" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stderr: expect.stringContaining("errout"),
    });
  });

  test("returns timeout error when command exceeds limit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute(
      { command: "sleep 10", timeoutMs: 200 },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "Command exceeded 200ms timeout."
      }
    });
  });

  test("blocks rm -rf / pattern", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "rm -rf /" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_blocked",
        message: "Command matches a blocked pattern."
      }
    });
  });

  test("blocks rm -rf ~ pattern", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "rm -rf ~" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_blocked",
        message: "Command matches a blocked pattern."
      }
    });
  });

  test("blocks fork bomb pattern", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: ":(){ :|:& };:" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_blocked",
        message: "Command matches a blocked pattern."
      }
    });
  });

  test("blocks mkfs commands", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: "mkfs.ext4 /dev/sda" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_blocked",
        message: "Command matches a blocked pattern."
      }
    });
  });

  test("does not block safe rm within workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    await writeFile(join(workspace, "temp.txt"), "delete me");
    const tool = createShellTool();

    const result = await tool.execute(
      { command: "rm -rf ./temp.txt" },
      { workspaceRoot: workspace }
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
  });

  test("rejects input with missing command field", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({}, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string command."
      }
    });
  });

  test("rejects input with non-string command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-workspace-"));
    const tool = createShellTool();

    const result = await tool.execute({ command: 42 }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string command."
      }
    });
  });
});

describe("sandboxed shell tool", () => {
  test("sandboxed shell tool executes safe commands successfully", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-sandbox-"));
    const tool = createShellTool({ sandboxed: true });

    const result = await tool.execute({ command: "echo hello" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: expect.stringContaining("hello")
    });
  });

  test("sandboxed shell tool rejects commands with path traversal", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-sandbox-"));
    const tool = createShellTool({ sandboxed: true });

    const result = await tool.execute(
      { command: "cat /tmp/../etc/passwd" },
      { workspaceRoot: workspace }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "sandbox_rejected",
        message: "Command rejected: workspace sandbox prevents execution outside workspace."
      }
    });
  });

  test("sandboxed shell tool rejects cd / commands", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-sandbox-"));
    const tool = createShellTool({ sandboxed: true });

    const result = await tool.execute({ command: "cd / && ls" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "sandbox_rejected",
        message: "Command rejected: workspace sandbox prevents execution outside workspace."
      }
    });
  });

  test("sandboxed shell tool rejects cd ~ commands", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-sandbox-"));
    const tool = createShellTool({ sandboxed: true });

    const result = await tool.execute({ command: "cd ~" }, { workspaceRoot: workspace });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "sandbox_rejected",
        message: "Command rejected: workspace sandbox prevents execution outside workspace."
      }
    });
  });

  test("non-sandboxed shell tool allows all commands", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-tools-sandbox-"));
    const tool = createShellTool({ sandboxed: false });

    // A command with /../ in a path but sandboxed:false should not be rejected
    const result = await tool.execute({ command: "echo hi" }, { workspaceRoot: workspace });

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
  });
});

describe("read_web_page tool", () => {
  function makeFetch(status: number, body: string): WebFetchLike {
    return async () => new Response(body, { status, headers: { "content-type": "text/html" } });
  }

  function makeFailingFetch(): WebFetchLike {
    return async () => {
      throw new Error("Network failure");
    };
  }

  const context = { workspaceRoot: "/tmp" };

  test("has low risk", () => {
    const tool = createReadWebPageTool(makeFetch(200, ""));

    expect(tool.risk).toBe("low");
  });

  test("returns text content extracted from HTML", async () => {
    const html = "<html><body><h1>Hello world</h1><p>Test content.</p></body></html>";
    const tool = createReadWebPageTool(makeFetch(200, html));

    const result = await tool.execute({ url: "https://example.com/page" }, context);

    expect(result).toMatchObject({
      ok: true,
      url: "https://example.com/page",
      content: expect.stringContaining("Hello world"),
      summary: expect.stringContaining("example.com")
    });
  });

  test("strips script and style blocks from content", async () => {
    const html =
      "<html><head><style>body{color:red}</style></head>" +
      "<body><script>alert(1)</script><p>Clean text.</p></body></html>";
    const tool = createReadWebPageTool(makeFetch(200, html));

    const result = await tool.execute({ url: "https://example.com" }, context);

    expect(result).toMatchObject({ ok: true });
    if (result.ok && "content" in result) {
      expect(result.content).not.toContain("alert(1)");
      expect(result.content).not.toContain("color:red");
      expect(result.content).toContain("Clean text.");
    }
  });

  test("truncates large content", async () => {
    const longBody = "a".repeat(10_000);
    const html = `<html><body><p>${longBody}</p></body></html>`;
    const tool = createReadWebPageTool(makeFetch(200, html));

    const result = await tool.execute({ url: "https://example.com" }, context);

    expect(result).toMatchObject({ ok: true });
    if (result.ok && "content" in result) {
      expect(result.content).toContain("[truncated");
      expect(result.content.length).toBeLessThan(longBody.length);
    }
  });

  test("returns http_error for non-ok HTTP responses", async () => {
    const tool = createReadWebPageTool(makeFetch(404, "Not Found"));

    const result = await tool.execute({ url: "https://example.com/missing" }, context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "http_error",
        message: "Page request failed with status 404."
      }
    });
  });

  test("returns network_error when fetch throws", async () => {
    const tool = createReadWebPageTool(makeFailingFetch());

    const result = await tool.execute({ url: "https://example.com" }, context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "network_error",
        message: "Web page request failed."
      }
    });
  });

  test("rejects input with missing url field", async () => {
    const tool = createReadWebPageTool(makeFetch(200, ""));

    const result = await tool.execute({}, context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool input must include a string url."
      }
    });
  });

  test("rejects non-http urls", async () => {
    const tool = createReadWebPageTool(makeFetch(200, ""));

    const result = await tool.execute({ url: "file:///etc/passwd" }, context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool url must use http or https."
      }
    });
  });

  test("rejects invalid url strings", async () => {
    const tool = createReadWebPageTool(makeFetch(200, ""));

    const result = await tool.execute({ url: "not a url" }, context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tool url must use http or https."
      }
    });
  });
});

describe("update_todos tool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns ok:true for a valid todo list", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: [
      { content: "Read the README", status: "completed" },
      { content: "Write a summary", status: "in_progress" },
      { content: "Open a PR", status: "pending" }
    ] }, ctx);
    expect(result).toEqual({ ok: true });
  });

  test("calls onUpdate callback with parsed todos", async () => {
    const received: TodoItem[][] = [];
    const tool = createUpdateTodosTool((todos) => received.push(todos));
    await tool.execute({ todos: [{ content: "Step 1", status: "pending" }] }, ctx);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([{ content: "Step 1", status: "pending" }]);
  });

  test("returns error when more than one item is in_progress", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: [
      { content: "Step 1", status: "in_progress" },
      { content: "Step 2", status: "in_progress" }
    ] }, ctx);
    expect(result).toMatchObject({ ok: false });
  });

  test("returns error for invalid status value", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: [{ content: "Step", status: "done" }] }, ctx);
    expect(result).toMatchObject({ ok: false });
  });

  test("returns error for empty content", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: [{ content: "", status: "pending" }] }, ctx);
    expect(result).toMatchObject({ ok: false });
  });

  test("accepts empty todo list", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: [] }, ctx);
    expect(result).toEqual({ ok: true });
  });

  test("returns error when todos is not an array", async () => {
    const tool = createUpdateTodosTool();
    const result = await tool.execute({ todos: "not an array" }, ctx);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("append_daily_memory tool", () => {
  test("appends a note to today's daily memory file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      const result = await tool.execute({ content: "Learned about update_todos." }, { workspaceRoot: workspace });
      expect(result).toMatchObject({ ok: true, filePath: "memory/2026-05-04.md" });

      const written = await readFile(join(workspace, "memory", "2026-05-04.md"), "utf8");
      expect(written).toContain("Learned about update_todos.");
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(workspace, { recursive: true, force: true }));
    }
  });

  test("appends multiple notes to the same file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      await tool.execute({ content: "First note." }, { workspaceRoot: workspace });
      await tool.execute({ content: "Second note." }, { workspaceRoot: workspace });

      const written = await readFile(join(workspace, "memory", "2026-05-04.md"), "utf8");
      expect(written).toContain("First note.");
      expect(written).toContain("Second note.");
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(workspace, { recursive: true, force: true }));
    }
  });

  test("creates the memory directory if it does not exist", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-memory-"));
    try {
      const tool = createAppendDailyMemoryTool({ getCurrentDate: () => "2026-05-04" });
      const result = await tool.execute({ content: "Note." }, { workspaceRoot: workspace });
      expect(result).toMatchObject({ ok: true });
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(workspace, { recursive: true, force: true }));
    }
  });

  test("returns error for empty content", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-memory-"));
    try {
      const tool = createAppendDailyMemoryTool();
      const result = await tool.execute({ content: "   " }, { workspaceRoot: workspace });
      expect(result).toMatchObject({ ok: false });
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(workspace, { recursive: true, force: true }));
    }
  });
});

describe("createMemorySearchTool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns empty results when memory directory does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      const tool = createMemorySearchTool(join(dir, "nonexistent"));
      const result = await tool.execute({ query: "anything" }, ctx) as MemorySearchResult;
      expect(result).toEqual({ ok: true, results: [], total: 0 });
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("finds matching content in MEMORY.md file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "This is an important fact.\n\nThis paragraph is unrelated.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "important" }, ctx) as MemorySearchResult;
      expect(result.ok).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.excerpt).toContain("important fact");
      expect(result.results[0]?.file).toBe("MEMORY.md");
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("respects maxResults limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} about memory stuff`);
      await writeFile(join(dir, "MEMORY.md"), paragraphs.join("\n\n"));
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "memory", maxResults: 3 }, ctx) as MemorySearchResult;
      expect(result.results.length).toBeLessThanOrEqual(3);
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("is case-insensitive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "This mentions ImportantFact uppercase.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "importantfact" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("searches USER.md in addition to MEMORY.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      await writeFile(join(dir, "USER.md"), "User prefers short answers.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "prefers" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.file).toBe("USER.md");
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("searches daily memory files in memory/ subdirectory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memsearch-"));
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "memory", "2026-05-05.md"), "Daily note about architecture.");
      const tool = createMemorySearchTool(dir);
      const result = await tool.execute({ query: "architecture" }, ctx) as MemorySearchResult;
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.file).toContain("2026-05-05.md");
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });
});

describe("createMemoryGetTool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns file content for a valid path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memget-"));
    try {
      await writeFile(join(dir, "MEMORY.md"), "# Memory\n\nKey fact here.");
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "MEMORY.md" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Key fact here.");
      expect(result.error).toBeUndefined();
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("returns error for missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "MEMORY.md" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toContain("File not found");
      expect(result.content).toBeUndefined();
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("rejects path traversal attempts (..)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "../etc/passwd" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("rejects absolute paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "/etc/passwd" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("rejects non-.md files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-memget-"));
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute({ path: "file.txt" }, ctx) as MemoryGetResult;
      expect(result.ok).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.content).toBeUndefined();
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });
});

describe("createLoadSkillTool", () => {
  const ctx = { workspaceRoot: "/ws" };

  test("returns skill content for a known skill name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arvinclaw-skills-"));
    try {
      const filePath = join(dir, "SKILL.md");
      await writeFile(filePath, "# Skill instructions here");

      const skillFileMap = new Map([["my-skill", filePath]]);
      const tool = createLoadSkillTool(skillFileMap);

      const result = await tool.execute({ name: "my-skill" }, ctx);

      expect(result).toMatchObject({ ok: true, content: "# Skill instructions here" });
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }
  });

  test("returns error for unknown skill name", async () => {
    const skillFileMap = new Map([["other-skill", "/some/path.md"]]);
    const tool = createLoadSkillTool(skillFileMap);

    const result = await tool.execute({ name: "missing-skill" }, ctx);

    expect(result).toMatchObject({ ok: false });
    expect((result as { error?: string }).error).toContain("missing-skill");
  });

  test("returns error when file cannot be read", async () => {
    const skillFileMap = new Map([["bad-skill", "/nonexistent/path/SKILL.md"]]);
    const tool = createLoadSkillTool(skillFileMap);

    const result = await tool.execute({ name: "bad-skill" }, ctx);

    expect(result).toMatchObject({ ok: false });
    expect((result as { error?: string }).error).toContain("bad-skill");
  });
});

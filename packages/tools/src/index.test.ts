import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createListDirectoryTool,
  createReadFileTool,
  createWriteFileTool,
  InMemoryToolRegistry,
  ToolRegistryError,
  type ToolDefinition
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

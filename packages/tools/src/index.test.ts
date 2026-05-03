import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createListDirectoryTool,
  createReadFileTool,
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

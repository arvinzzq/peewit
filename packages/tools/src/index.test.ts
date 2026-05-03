import { describe, expect, test } from "vitest";
import { InMemoryToolRegistry, ToolRegistryError, type ToolDefinition } from "./index.js";

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

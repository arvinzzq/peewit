import { describe, expect, test } from "vitest";
import {
  adaptersPackageName,
  BACKGROUND_CAPABILITIES,
  CLI_CAPABILITIES,
  WEB_CAPABILITIES,
  TOOL_PROFILES,
  filterToolsByProfile,
  type AdapterCapabilities,
  type AdapterStorageType
} from "./index.js";

describe("adaptersPackageName", () => {
  test("has expected package name", () => {
    expect(adaptersPackageName).toBe("@peewit/adapters");
  });
});

describe("AdapterCapabilities", () => {
  test("CLI_CAPABILITIES has streaming and approvalPrompts, not background", () => {
    expect(CLI_CAPABILITIES.streaming).toBe(true);
    expect(CLI_CAPABILITIES.approvalPrompts).toBe(true);
    expect(CLI_CAPABILITIES.background).toBe(false);
  });

  test("WEB_CAPABILITIES has streaming and approvalPrompts, not background", () => {
    expect(WEB_CAPABILITIES.streaming).toBe(true);
    expect(WEB_CAPABILITIES.approvalPrompts).toBe(true);
    expect(WEB_CAPABILITIES.background).toBe(false);
  });

  test("BACKGROUND_CAPABILITIES has background only, no streaming or approvalPrompts", () => {
    expect(BACKGROUND_CAPABILITIES.streaming).toBe(false);
    expect(BACKGROUND_CAPABILITIES.approvalPrompts).toBe(false);
    expect(BACKGROUND_CAPABILITIES.background).toBe(true);
  });

  test("constants satisfy AdapterCapabilities interface", () => {
    const checkInterface = (caps: AdapterCapabilities) => {
      expect(typeof caps.streaming).toBe("boolean");
      expect(typeof caps.approvalPrompts).toBe("boolean");
      expect(typeof caps.background).toBe("boolean");
    };

    checkInterface(CLI_CAPABILITIES);
    checkInterface(WEB_CAPABILITIES);
    checkInterface(BACKGROUND_CAPABILITIES);
  });

  test("a background-capable adapter cannot approve interactively", () => {
    // background adapters must not have approvalPrompts — they run unattended
    const backgroundAdapters = [BACKGROUND_CAPABILITIES];
    for (const caps of backgroundAdapters) {
      if (caps.background) {
        expect(caps.approvalPrompts).toBe(false);
      }
    }
  });
});

describe("AdapterStorageType", () => {
  test("valid storage types can be assigned", () => {
    const types: AdapterStorageType[] = ["in-memory", "jsonl", "sqlite"];
    expect(types).toHaveLength(3);
  });
});

describe("TOOL_PROFILES", () => {
  test("has definitions for all four profiles", () => {
    expect(TOOL_PROFILES.full).toBeDefined();
    expect(TOOL_PROFILES.coding).toBeDefined();
    expect(TOOL_PROFILES.messaging).toBeDefined();
    expect(TOOL_PROFILES.background).toBeDefined();
  });

  test("full profile has empty allowedTools (no restriction)", () => {
    expect(TOOL_PROFILES.full.allowedTools).toHaveLength(0);
  });

  test("coding profile includes file system and shell tools", () => {
    const { allowedTools } = TOOL_PROFILES.coding;
    expect(allowedTools).toContain("read_file");
    expect(allowedTools).toContain("write_file");
    expect(allowedTools).toContain("run_shell");
    expect(allowedTools).not.toContain("read_web_page");
  });

  test("messaging profile does not include write_file or run_shell", () => {
    const { allowedTools } = TOOL_PROFILES.messaging;
    expect(allowedTools).toContain("read_file");
    expect(allowedTools).not.toContain("write_file");
    expect(allowedTools).not.toContain("run_shell");
  });

  test("background profile does not include run_shell", () => {
    const { allowedTools } = TOOL_PROFILES.background;
    expect(allowedTools).not.toContain("run_shell");
    expect(allowedTools).toContain("write_file");
  });
});

describe("filterToolsByProfile", () => {
  const allTools = [
    { name: "read_file" },
    { name: "write_file" },
    { name: "run_shell" },
    { name: "read_web_page" },
    { name: "memory_search" },
    { name: "update_todos" },
    { name: "spawn_subagent" }
  ];

  test("filterToolsByProfile returns all tools for full profile", () => {
    const result = filterToolsByProfile(allTools, "full");
    expect(result).toHaveLength(allTools.length);
    expect(result).toEqual(allTools);
  });

  test("filterToolsByProfile returns only allowed tools for coding profile", () => {
    const result = filterToolsByProfile(allTools, "coding");
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("run_shell");
    expect(names).not.toContain("read_web_page");
    expect(names).not.toContain("memory_search");
  });

  test("filterToolsByProfile returns only allowed tools for messaging profile", () => {
    const result = filterToolsByProfile(allTools, "messaging");
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("read_web_page");
    expect(names).toContain("memory_search");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("spawn_subagent");
  });

  test("filterToolsByProfile returns only allowed tools for background profile", () => {
    const result = filterToolsByProfile(allTools, "background");
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("memory_search");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("read_web_page");
  });
});

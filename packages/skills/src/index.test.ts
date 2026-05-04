import { describe, expect, test } from "vitest";
import { SkillLoader, parseSKILLMd, toSkillSummary, type SkillDefinition } from "./index.js";

describe("parseSKILLMd", () => {
  test("parses valid SKILL.md frontmatter and body", () => {
    const content = [
      "---",
      "name: research",
      "description: Use when investigating external information or comparing sources.",
      "---",
      "",
      "Search and compare sources."
    ].join("\n");

    expect(parseSKILLMd(content)).toEqual({
      name: "research",
      description: "Use when investigating external information or comparing sources.",
      body: "Search and compare sources."
    });
  });

  test("returns null when frontmatter opening delimiter is missing", () => {
    const content = "name: research\ndescription: skill\n";
    expect(parseSKILLMd(content)).toBeNull();
  });

  test("returns null when closing delimiter is missing", () => {
    const content = "---\nname: research\ndescription: skill\n";
    expect(parseSKILLMd(content)).toBeNull();
  });

  test("returns null when required fields are missing", () => {
    const missing = [
      "---\ndescription: skill\n---\nbody",
      "---\nname: research\n---\nbody"
    ];
    for (const content of missing) {
      expect(parseSKILLMd(content)).toBeNull();
    }
  });

  test("handles empty body gracefully", () => {
    const content = "---\nname: research\ndescription: skill\n---\n";
    const result = parseSKILLMd(content);
    expect(result).not.toBeNull();
    expect(result?.body).toBe("");
  });

  test("ignores unknown frontmatter fields", () => {
    const content = "---\nname: research\ndescription: skill\nwhen: legacy field\nauthor: test\n---\nbody";
    const result = parseSKILLMd(content);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("research");
    expect(result?.description).toBe("skill");
    expect(result?.body).toBe("body");
  });
});

describe("SkillLoader", () => {
  test("returns built-in skills when no workspace or user dirs are provided", async () => {
    const loader = new SkillLoader();
    const skills = await loader.load();

    const names = skills.map((s) => s.name);
    expect(names).toContain("research");
    expect(names).toContain("project-inspector");
    expect(names).toContain("safe-shell");
    expect(skills.filter((s) => s.source === "built-in")).toHaveLength(3);
  });

  test("loads workspace skills from workspaceRoot/skills/<name>/SKILL.md", async () => {
    const fakeFiles: Record<string, string> = {
      "/ws/skills/my-skill/SKILL.md": [
        "---",
        "name: my-skill",
        "description: A custom skill for specific project tasks.",
        "---",
        "Do the custom task."
      ].join("\n")
    };
    const loader = new SkillLoader();
    const skills = await loader.load({
      workspaceRoot: "/ws",
      readDir: async (p) => (p === "/ws/skills" ? ["my-skill"] : []),
      readFile: async (p) => {
        const content = fakeFiles[p];
        if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return content;
      }
    });

    const mySkill = skills.find((s) => s.name === "my-skill");
    expect(mySkill).toMatchObject({
      name: "my-skill",
      description: "A custom skill for specific project tasks.",
      source: "workspace"
    });
  });

  test("workspace skill overrides built-in skill with the same name", async () => {
    const loader = new SkillLoader();
    const skills = await loader.load({
      workspaceRoot: "/ws",
      readDir: async (p) => (p === "/ws/skills" ? ["research"] : []),
      readFile: async (p) =>
        p === "/ws/skills/research/SKILL.md"
          ? "---\nname: research\ndescription: Project-specific research.\n---\nCustom body."
          : (() => { throw Object.assign(new Error(), { code: "ENOENT" }); })()
    });

    const researches = skills.filter((s) => s.name === "research");
    expect(researches).toHaveLength(1);
    expect(researches[0]?.source).toBe("workspace");
    expect(researches[0]?.description).toBe("Project-specific research.");
  });

  test("user skill overrides built-in but not workspace skill", async () => {
    const loader = new SkillLoader();
    const skills = await loader.load({
      workspaceRoot: "/ws",
      userSkillsDir: "/user/skills",
      readDir: async (p) => {
        if (p === "/ws/skills") return ["research"];
        if (p === "/user/skills") return ["research", "custom-user"];
        return [];
      },
      readFile: async (p) => {
        if (p === "/ws/skills/research/SKILL.md")
          return "---\nname: research\ndescription: Workspace version.\n---\n";
        if (p === "/user/skills/research/SKILL.md")
          return "---\nname: research\ndescription: User version.\n---\n";
        if (p === "/user/skills/custom-user/SKILL.md")
          return "---\nname: custom-user\ndescription: User custom skill.\n---\n";
        throw Object.assign(new Error(), { code: "ENOENT" });
      }
    });

    // workspace version wins for research
    const research = skills.find((s) => s.name === "research");
    expect(research?.source).toBe("workspace");
    expect(research?.description).toBe("Workspace version.");

    // user custom skill is included
    const customUser = skills.find((s) => s.name === "custom-user");
    expect(customUser?.source).toBe("user");
  });

  test("skips missing workspace skills directory without error", async () => {
    const loader = new SkillLoader();
    const skills = await loader.load({
      workspaceRoot: "/nonexistent",
      readDir: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); },
      readFile: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); }
    });

    // Falls back to built-ins only
    expect(skills.some((s) => s.source === "built-in")).toBe(true);
    expect(skills.some((s) => s.source === "workspace")).toBe(false);
  });

  test("skips unreadable or invalid skill files without error", async () => {
    const loader = new SkillLoader();
    const skills = await loader.load({
      workspaceRoot: "/ws",
      readDir: async (p) => (p === "/ws/skills" ? ["bad-skill", "good-skill"] : []),
      readFile: async (p) => {
        if (p.includes("bad-skill")) throw new Error("Permission denied.");
        return "---\nname: good-skill\ndescription: A working skill.\n---\n";
      }
    });

    expect(skills.find((s) => s.name === "good-skill")).toBeDefined();
    expect(skills.find((s) => s.name === "bad-skill")).toBeUndefined();
  });
});

describe("toSkillSummary", () => {
  test("extracts summary fields from a skill definition", () => {
    const skill: SkillDefinition = {
      name: "research",
      description: "Use when investigating external information or comparing sources.",
      body: "Long body text...",
      source: "built-in"
    };

    expect(toSkillSummary(skill)).toEqual({
      name: "research",
      description: "Use when investigating external information or comparing sources.",
      source: "built-in"
    });
  });
});

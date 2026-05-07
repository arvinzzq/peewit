import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SkillLoader, SkillManager, parseSKILLMd, toSkillSummary, type SkillDefinition } from "./index.js";

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

  test("parses version field", () => {
    const content = "---\nname: my-skill\ndescription: A skill.\nversion: 1.2.0\n---\nbody";
    const result = parseSKILLMd(content);
    expect(result?.version).toBe("1.2.0");
  });

  test("parses origin field", () => {
    const content = "---\nname: my-skill\ndescription: A skill.\norigin: https://example.com/skill.md\n---\nbody";
    const result = parseSKILLMd(content);
    expect(result?.origin).toBe("https://example.com/skill.md");
  });

  test("parses permissions as comma-separated string", () => {
    const content = "---\nname: my-skill\ndescription: A skill.\npermissions: filesystem, shell\n---\nbody";
    const result = parseSKILLMd(content);
    expect(result?.permissions).toEqual(["filesystem", "shell"]);
  });

  test("parses permissions as YAML array", () => {
    const content = [
      "---",
      "name: my-skill",
      "description: A skill.",
      "permissions:",
      "  - filesystem",
      "  - shell",
      "---",
      "body"
    ].join("\n");
    const result = parseSKILLMd(content);
    expect(result?.permissions).toEqual(["filesystem", "shell"]);
  });

  test("parses all extended fields together", () => {
    const content = "---\nname: my-skill\ndescription: A skill.\nversion: 1.2.0\norigin: https://example.com\npermissions: filesystem, shell\n---\nbody";
    const result = parseSKILLMd(content);
    expect(result).toMatchObject({
      name: "my-skill",
      description: "A skill.",
      version: "1.2.0",
      origin: "https://example.com",
      permissions: ["filesystem", "shell"],
      body: "body"
    });
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
        if (p === "/user/skills") return ["research.md", "custom-user.md"];
        return [];
      },
      readFile: async (p) => {
        if (p === "/ws/skills/research/SKILL.md")
          return "---\nname: research\ndescription: Workspace version.\n---\n";
        if (p === "/user/skills/research.md")
          return "---\nname: research\ndescription: User version.\n---\n";
        if (p === "/user/skills/custom-user.md")
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

  test("skips disabled user skills via manifest", async () => {
    const manifest = JSON.stringify({
      skills: [{ name: "disabled-skill", filePath: "/user/skills/disabled-skill.md", installedAt: "2026-01-01T00:00:00.000Z", trusted: true, enabled: false }]
    });

    const loader = new SkillLoader();
    const skills = await loader.load({
      userSkillsDir: "/user/skills",
      readDir: async (p) => (p === "/user/skills" ? ["disabled-skill.md", "enabled-skill.md"] : []),
      readFile: async (p) => {
        if (p === "/user/skills/skills-index.json") return manifest;
        if (p === "/user/skills/disabled-skill.md")
          return "---\nname: disabled-skill\ndescription: Should be skipped.\n---\nbody";
        if (p === "/user/skills/enabled-skill.md")
          return "---\nname: enabled-skill\ndescription: Should be loaded.\n---\nbody";
        throw Object.assign(new Error(), { code: "ENOENT" });
      }
    });

    expect(skills.find((s) => s.name === "disabled-skill")).toBeUndefined();
    expect(skills.find((s) => s.name === "enabled-skill")).toBeDefined();
  });

  test("marks user skills as untrusted when not in manifest", async () => {
    const manifest = JSON.stringify({ skills: [] });

    const loader = new SkillLoader();
    const skills = await loader.load({
      userSkillsDir: "/user/skills",
      readDir: async (p) => (p === "/user/skills" ? ["new-skill.md"] : []),
      readFile: async (p) => {
        if (p === "/user/skills/skills-index.json") return manifest;
        if (p === "/user/skills/new-skill.md")
          return "---\nname: new-skill\ndescription: New user skill.\n---\nbody";
        throw Object.assign(new Error(), { code: "ENOENT" });
      }
    });

    const skill = skills.find((s) => s.name === "new-skill");
    expect(skill?.trusted).toBe(false);
  });
});

describe("SkillManager", () => {
  async function makeTmpDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "vole-test-"));
  }

  async function cleanup(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  test("install copies file and creates manifest entry", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "my-skill.md");
      await writeFile(srcPath, "---\nname: my-skill\ndescription: A skill.\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      const entry = await manager.install(srcPath);

      expect(entry.name).toBe("my-skill");
      expect(entry.trusted).toBe(false);
      expect(entry.enabled).toBe(true);

      const manifest = await manager.loadManifest();
      expect(manifest.skills).toHaveLength(1);
      expect(manifest.skills[0]?.name).toBe("my-skill");
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("install with version and origin preserves origin in manifest", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "versioned.md");
      await writeFile(srcPath, "---\nname: versioned\ndescription: A versioned skill.\nversion: 2.0.0\norigin: https://example.com/versioned.md\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      const entry = await manager.install(srcPath);

      expect(entry.origin).toBe("https://example.com/versioned.md");
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("disable sets enabled: false in manifest", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "my-skill.md");
      await writeFile(srcPath, "---\nname: my-skill\ndescription: A skill.\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      await manager.install(srcPath);
      await manager.disable("my-skill");

      const manifest = await manager.loadManifest();
      expect(manifest.skills[0]?.enabled).toBe(false);
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("enable sets enabled: true in manifest", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "my-skill.md");
      await writeFile(srcPath, "---\nname: my-skill\ndescription: A skill.\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      await manager.install(srcPath);
      await manager.disable("my-skill");
      await manager.enable("my-skill");

      const manifest = await manager.loadManifest();
      expect(manifest.skills[0]?.enabled).toBe(true);
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("trust sets trusted: true in manifest", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "my-skill.md");
      await writeFile(srcPath, "---\nname: my-skill\ndescription: A skill.\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      await manager.install(srcPath);
      await manager.trust("my-skill");

      const manifest = await manager.loadManifest();
      expect(manifest.skills[0]?.trusted).toBe(true);
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("review returns SkillDefinition with trust and enabled state", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "my-skill.md");
      await writeFile(srcPath, "---\nname: my-skill\ndescription: A skill.\nversion: 1.0.0\npermissions: filesystem\n---\nbody text", "utf8");

      const manager = new SkillManager(tmpDir);
      await manager.install(srcPath);
      const def = await manager.review("my-skill");

      expect(def?.name).toBe("my-skill");
      expect(def?.trusted).toBe(false);
      expect(def?.enabled).toBe(true);
      expect(def?.version).toBe("1.0.0");
      expect(def?.permissions).toEqual(["filesystem"]);
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("listEntries returns manifest entries", async () => {
    const tmpDir = await makeTmpDir();
    const srcDir = await makeTmpDir();
    try {
      const srcPath = join(srcDir, "skill-a.md");
      await writeFile(srcPath, "---\nname: skill-a\ndescription: A.\n---\nbody", "utf8");

      const manager = new SkillManager(tmpDir);
      await manager.install(srcPath);
      const entries = await manager.listEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("skill-a");
    } finally {
      await cleanup(tmpDir);
      await cleanup(srcDir);
    }
  });

  test("throws when enable/disable/trust called for unknown skill", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const manager = new SkillManager(tmpDir);
      await expect(manager.enable("nonexistent")).rejects.toThrow("not found");
      await expect(manager.disable("nonexistent")).rejects.toThrow("not found");
      await expect(manager.trust("nonexistent")).rejects.toThrow("not found");
    } finally {
      await cleanup(tmpDir);
    }
  });
});

describe("toSkillSummary", () => {
  test("extracts summary fields from a skill definition", () => {
    const skill: SkillDefinition = {
      name: "research",
      description: "Use when investigating external information or comparing sources.",
      body: "Long body text...",
      source: "built-in",
      filePath: ""
    };

    expect(toSkillSummary(skill)).toEqual({
      name: "research",
      description: "Use when investigating external information or comparing sources.",
      source: "built-in"
    });
  });
});

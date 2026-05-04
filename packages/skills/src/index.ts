/**
 * INPUT: SKILL.md files from workspace, user, and built-in skill directories.
 * OUTPUT: SkillDefinition list with name, description, body, and source; SkillSummary for context injection; SkillLoader with precedence and injectable file system ops.
 * POS: Skill system layer; discovers and parses skills for prompt integration.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const skillsPackageName = "@arvinclaw/skills";

export type SkillSource = "built-in" | "user" | "workspace";

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
}

export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

export interface SkillLoaderOptions {
  workspaceRoot?: string;
  userSkillsDir?: string;
  readDir?: (path: string) => Promise<string[]>;
  readFile?: (path: string) => Promise<string>;
}

const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    name: "research",
    description: "Use when investigating external information, comparing sources, or summarizing findings. Guides web search, source reading, source comparison, and citation-aware output.",
    body: "Search for relevant sources, read and compare at least two, and summarize findings with source links. Prefer primary sources. Flag conflicting evidence.",
    source: "built-in"
  },
  {
    name: "project-inspector",
    description: "Use when understanding a codebase, identifying technologies, or summarizing module responsibilities. Guides project structure inspection and technology detection.",
    body: "Read README, list top-level directories, inspect package files, and summarize each module's role. Identify entry points and dependency boundaries.",
    source: "built-in"
  },
  {
    name: "safe-shell",
    description: "Use when planning to run shell commands, especially destructive or irreversible ones. Guides shell command risk assessment and command purpose explanation.",
    body: "State the purpose before running. Prefer read-only commands. Avoid rm -rf, force flags, or piped untrusted input. Confirm intent before destructive operations.",
    source: "built-in"
  }
];

export class SkillLoader {
  async load(options: SkillLoaderOptions = {}): Promise<SkillDefinition[]> {
    const seen = new Set<string>();
    const skills: SkillDefinition[] = [];

    const add = (skill: SkillDefinition) => {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    };

    // 1. Workspace skills (highest precedence)
    if (options.workspaceRoot !== undefined) {
      const workspaceDir = join(options.workspaceRoot, "skills");
      for (const skill of await this.#loadFromDir(workspaceDir, "workspace", options)) {
        add(skill);
      }
    }

    // 2. User skills
    const userDir = options.userSkillsDir ?? join(homedir(), ".arvinclaw", "skills");
    for (const skill of await this.#loadFromDir(userDir, "user", options)) {
      add(skill);
    }

    // 3. Built-in skills (lowest precedence)
    for (const skill of BUILTIN_SKILLS) {
      add(skill);
    }

    return skills;
  }

  async #loadFromDir(
    dirPath: string,
    source: "workspace" | "user",
    options: SkillLoaderOptions
  ): Promise<SkillDefinition[]> {
    const doReadDir = options.readDir ?? ((p) => readdir(p));
    const doReadFile = options.readFile ?? ((p) => readFile(p, "utf8"));

    let entries: string[];
    try {
      entries = await doReadDir(dirPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const skills: SkillDefinition[] = [];
    for (const entry of entries) {
      try {
        const content = await doReadFile(join(dirPath, entry, "SKILL.md"));
        const parsed = parseSKILLMd(content);
        if (parsed !== null) {
          skills.push({ ...parsed, source });
        }
      } catch {
        // Skip unreadable or invalid skill files silently.
      }
    }
    return skills;
  }
}

export function parseSKILLMd(
  content: string
): { name: string; description: string; body: string } | null {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") return null;

  const closingIndex = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closingIndex === -1) return null;

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n").trim();

  const fields: Record<string, string> = {};
  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length > 0) fields[key] = value;
  }

  const { name, description } = fields;
  if (!name || !description) return null;

  return { name, description, body };
}

export function toSkillSummary(skill: SkillDefinition): SkillSummary {
  return { name: skill.name, description: skill.description, source: skill.source };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * INPUT: SKILL.md files from workspace, user, and built-in skill directories; skills-index.json manifest from user skills directory.
 * OUTPUT: SkillDefinition list with name, description, body, source, filePath, version, origin, permissions, trusted, enabled; SkillSummary for context injection; SkillLoader with precedence and injectable file system ops; SkillManager for install/enable/disable/trust lifecycle; SkillManifest and SkillManifestEntry types.
 * POS: Skill system layer; discovers, parses, and manages skills for prompt integration and user lifecycle control.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { copyFile, mkdir, readFile as fsReadFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const skillsPackageName = "@peewit/skills";

export type SkillSource = "built-in" | "user" | "workspace";

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  filePath: string;
  version?: string;
  origin?: string;
  permissions?: string[];
  trusted?: boolean;
  enabled?: boolean;
}

export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

export interface SkillManifestEntry {
  name: string;
  filePath: string;
  installedAt: string;
  origin?: string;
  trusted: boolean;
  enabled: boolean;
}

export interface SkillManifest {
  skills: SkillManifestEntry[];
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
    source: "built-in",
    filePath: ""
  },
  {
    name: "project-inspector",
    description: "Use when understanding a codebase, identifying technologies, or summarizing module responsibilities. Guides project structure inspection and technology detection.",
    body: "Read README, list top-level directories, inspect package files, and summarize each module's role. Identify entry points and dependency boundaries.",
    source: "built-in",
    filePath: ""
  },
  {
    name: "safe-shell",
    description: "Use when planning to run shell commands, especially destructive or irreversible ones. Guides shell command risk assessment and command purpose explanation.",
    body: "State the purpose before running. Prefer read-only commands. Avoid rm -rf, force flags, or piped untrusted input. Confirm intent before destructive operations.",
    source: "built-in",
    filePath: ""
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

    // 2. User skills — consult manifest for enabled/trusted
    const userDir = options.userSkillsDir ?? join(homedir(), ".peewit", "skills");
    const manifest = await loadManifestFromDir(userDir, options.readFile);
    for (const skill of await this.#loadFromDir(userDir, "user", options, manifest)) {
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
    options: SkillLoaderOptions,
    manifest?: SkillManifest
  ): Promise<SkillDefinition[]> {
    const doReadDir = options.readDir ?? ((p) => readdir(p));
    const doReadFile = options.readFile ?? ((p) => fsReadFile(p, "utf8"));

    let entries: string[];
    try {
      entries = await doReadDir(dirPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const skills: SkillDefinition[] = [];
    for (const entry of entries) {
      // User skills are flat .md files; workspace skills are subdirectories with SKILL.md
      const filePath = source === "user"
        ? join(dirPath, entry)
        : join(dirPath, entry, "SKILL.md");

      if (source === "user" && !entry.endsWith(".md")) continue;
      if (source === "user" && entry === "skills-index.json") continue;

      // Check manifest for user skills
      if (source === "user" && manifest !== undefined) {
        const entryName = entry.replace(/\.md$/, "");
        const manifestEntry = manifest.skills.find((e) => e.name === entryName);
        if (manifestEntry !== undefined && manifestEntry.enabled === false) {
          continue; // skip disabled
        }
      }

      try {
        const content = await doReadFile(filePath);
        const parsed = parseSKILLMd(content);
        if (parsed !== null) {
          let trusted: boolean | undefined;
          let enabled: boolean | undefined;

          if (source === "user") {
            const manifestEntry = manifest?.skills.find((e) => e.name === parsed.name);
            trusted = manifestEntry?.trusted ?? false;
            enabled = manifestEntry?.enabled ?? true;
          }

          const def: SkillDefinition = {
            ...parsed,
            source,
            filePath,
            ...(trusted !== undefined ? { trusted } : {}),
            ...(enabled !== undefined ? { enabled } : {})
          };
          skills.push(def);
        }
      } catch {
        // Skip unreadable or invalid skill files silently.
      }
    }
    return skills;
  }
}

async function loadManifestFromDir(
  dirPath: string,
  readFileFn?: (path: string) => Promise<string>
): Promise<SkillManifest | undefined> {
  const doReadFile = readFileFn ?? ((p) => fsReadFile(p, "utf8"));
  const manifestPath = join(dirPath, "skills-index.json");

  try {
    const content = await doReadFile(manifestPath);
    return JSON.parse(content) as SkillManifest;
  } catch {
    return undefined;
  }
}

export class SkillManager {
  readonly #skillsDirectory: string;

  constructor(skillsDirectory: string) {
    this.#skillsDirectory = skillsDirectory;
  }

  async loadManifest(): Promise<SkillManifest> {
    const manifestPath = join(this.#skillsDirectory, "skills-index.json");
    try {
      const content = await fsReadFile(manifestPath, "utf8");
      return JSON.parse(content) as SkillManifest;
    } catch {
      return { skills: [] };
    }
  }

  async saveManifest(manifest: SkillManifest): Promise<void> {
    await mkdir(this.#skillsDirectory, { recursive: true });
    const manifestPath = join(this.#skillsDirectory, "skills-index.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  async install(sourcePath: string): Promise<SkillManifestEntry> {
    const fileName = basename(sourcePath);
    const nameWithoutExt = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;

    // Parse the source file to extract name
    const content = await fsReadFile(sourcePath, "utf8");
    const parsed = parseSKILLMd(content);
    const name = parsed?.name ?? nameWithoutExt;

    await mkdir(this.#skillsDirectory, { recursive: true });
    const destPath = join(this.#skillsDirectory, `${name}.md`);
    await copyFile(sourcePath, destPath);

    const manifest = await this.loadManifest();
    const existingIndex = manifest.skills.findIndex((e) => e.name === name);

    const entry: SkillManifestEntry = {
      name,
      filePath: destPath,
      installedAt: new Date().toISOString(),
      ...(parsed?.origin !== undefined ? { origin: parsed.origin } : {}),
      trusted: false,
      enabled: true
    };

    if (existingIndex !== -1) {
      manifest.skills[existingIndex] = entry;
    } else {
      manifest.skills.push(entry);
    }

    await this.saveManifest(manifest);
    return entry;
  }

  async enable(name: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entry = manifest.skills.find((e) => e.name === name);
    if (entry === undefined) throw new Error(`Skill "${name}" not found in manifest.`);
    entry.enabled = true;
    await this.saveManifest(manifest);
  }

  async disable(name: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entry = manifest.skills.find((e) => e.name === name);
    if (entry === undefined) throw new Error(`Skill "${name}" not found in manifest.`);
    entry.enabled = false;
    await this.saveManifest(manifest);
  }

  async trust(name: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entry = manifest.skills.find((e) => e.name === name);
    if (entry === undefined) throw new Error(`Skill "${name}" not found in manifest.`);
    entry.trusted = true;
    await this.saveManifest(manifest);
  }

  async review(name: string): Promise<SkillDefinition | undefined> {
    const manifest = await this.loadManifest();
    const entry = manifest.skills.find((e) => e.name === name);
    if (entry === undefined) return undefined;

    try {
      const content = await fsReadFile(entry.filePath, "utf8");
      const parsed = parseSKILLMd(content);
      if (parsed === null) return undefined;

      return {
        ...parsed,
        source: "user",
        filePath: entry.filePath,
        trusted: entry.trusted,
        enabled: entry.enabled
      };
    } catch {
      return undefined;
    }
  }

  async listEntries(): Promise<SkillManifestEntry[]> {
    const manifest = await this.loadManifest();
    return manifest.skills;
  }
}

export function parseSKILLMd(
  content: string
): { name: string; description: string; body: string; version?: string; origin?: string; permissions?: string[] } | null {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") return null;

  const closingIndex = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closingIndex === -1) return null;

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n").trim();

  const fields: Record<string, string> = {};
  const arrayFields: Record<string, string[]> = {};
  let currentArrayKey: string | null = null;

  for (const line of frontmatterLines) {
    // Check for array item (starts with "  - " or "- ")
    const arrayItemMatch = /^\s+-\s+(.+)$/.exec(line);
    if (arrayItemMatch !== null && currentArrayKey !== null) {
      const value = arrayItemMatch[1]?.trim() ?? "";
      if (value.length > 0) {
        arrayFields[currentArrayKey] = [...(arrayFields[currentArrayKey] ?? []), value];
      }
      continue;
    }

    // Regular key: value line
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      currentArrayKey = null;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (key.length === 0) {
      currentArrayKey = null;
      continue;
    }

    if (rawValue === "") {
      // Potential start of a YAML array block
      currentArrayKey = key;
    } else {
      currentArrayKey = null;
      fields[key] = rawValue;
    }
  }

  const { name, description, version, origin, permissions: permissionsStr } = fields;
  if (!name || !description) return null;

  // Parse permissions from comma-separated string or array form
  let permissions: string[] | undefined;
  if (permissionsStr !== undefined && permissionsStr.length > 0) {
    permissions = permissionsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  } else if (arrayFields["permissions"] !== undefined) {
    permissions = arrayFields["permissions"];
  }

  return {
    name,
    description,
    body,
    ...(version !== undefined ? { version } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(permissions !== undefined ? { permissions } : {})
  };
}

export function toSkillSummary(skill: SkillDefinition): SkillSummary {
  return { name: skill.name, description: skill.description, source: skill.source };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

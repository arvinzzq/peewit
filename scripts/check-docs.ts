/**
 * INPUT: Markdown docs, module guide paths, and required source entry files.
 * OUTPUT: Documentation policy issue lists and a CLI exit code for docs:check.
 * POS: Documentation quality gate; keeps links, bilingual headings, module guides, and headers aligned.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MarkdownLinkIssue {
  file: string;
  target: string;
}

export interface BilingualHeadingIssue {
  file: string;
  englishHeadings: number;
  chineseHeadings: number;
}

export interface MissingModuleDocIssue {
  directory: string;
  file: string;
}

export interface MissingSourceHeaderIssue {
  file: string;
  missingMarkers: string[];
}

export const requiredModuleDocDirectories = [
  "apps/cli",
  "packages/config",
  "packages/context",
  "packages/core",
  "packages/lanes",
  "packages/models",
  "packages/permissions",
  "packages/sessions",
  "packages/skills",
  "packages/tools",
  "scripts",
  "tests"
] as const;

export const requiredModuleDocFiles = [
  "README.md",
  "README.zh-CN.md",
  "AGENTS.md",
  "AGENTS.zh-CN.md"
] as const;

export const requiredSourceHeaderFiles = [
  "apps/cli/src/index.ts",
  "packages/config/src/index.ts",
  "packages/context/src/index.ts",
  "packages/core/src/index.ts",
  "packages/lanes/src/index.ts",
  "packages/models/src/index.ts",
  "packages/permissions/src/index.ts",
  "packages/sessions/src/index.ts",
  "packages/skills/src/index.ts",
  "packages/tools/src/index.ts",
  "scripts/check-docs.ts"
] as const;

export function findMarkdownLinkIssues(rootDir: string): MarkdownLinkIssue[] {
  const issues: MarkdownLinkIssue[] = [];

  for (const file of findMarkdownFiles(rootDir)) {
    const text = readFileSync(file, "utf8");
    const linkPattern = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g;

    for (const match of text.matchAll(linkPattern)) {
      const target = match[1];
      if (target === undefined || shouldSkipTarget(target)) {
        continue;
      }

      const targetPath = resolve(dirname(file), target);
      if (!existsSync(targetPath)) {
        issues.push({ file, target });
      }
    }
  }

  return issues;
}

export function findBilingualHeadingIssues(rootDir: string): BilingualHeadingIssue[] {
  const issues: BilingualHeadingIssue[] = [];

  for (const file of findMarkdownFiles(rootDir)) {
    if (file.endsWith(".zh-CN.md")) {
      continue;
    }

    const chineseFile = file.replace(/\.md$/, ".zh-CN.md");
    if (!existsSync(chineseFile)) {
      continue;
    }

    const englishHeadings = countHeadings(file);
    const chineseHeadings = countHeadings(chineseFile);

    if (englishHeadings !== chineseHeadings) {
      issues.push({ file, englishHeadings, chineseHeadings });
    }
  }

  return issues;
}

export function findMissingModuleDocs(rootDir: string): MissingModuleDocIssue[] {
  const issues: MissingModuleDocIssue[] = [];
  const root = resolve(rootDir);

  for (const directory of requiredModuleDocDirectories) {
    for (const file of requiredModuleDocFiles) {
      if (!existsSync(join(root, directory, file))) {
        issues.push({ directory, file });
      }
    }
  }

  return issues;
}

export function findMissingSourceHeaders(rootDir: string): MissingSourceHeaderIssue[] {
  const issues: MissingSourceHeaderIssue[] = [];
  const root = resolve(rootDir);
  const requiredMarkers = ["INPUT:", "OUTPUT:", "POS:"] as const;

  for (const file of requiredSourceHeaderFiles) {
    const filePath = join(root, file);
    if (!existsSync(filePath)) {
      issues.push({ file, missingMarkers: [...requiredMarkers] });
      continue;
    }

    const firstBlock = readFileSync(filePath, "utf8").slice(0, 600);
    const missingMarkers = requiredMarkers.filter((marker) => !firstBlock.includes(marker));

    if (missingMarkers.length > 0) {
      issues.push({ file, missingMarkers });
    }
  }

  return issues;
}

function findMarkdownFiles(rootDir: string): string[] {
  const root = resolve(rootDir);
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(entryPath));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function shouldSkipTarget(target: string): boolean {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("#")
  );
}

function countHeadings(file: string): number {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("#")).length;
}

function main(): void {
  const rootDir = process.argv[2] ?? "docs";
  const linkIssues = findMarkdownLinkIssues(rootDir);
  const headingIssues = findBilingualHeadingIssues(rootDir);
  const projectRoot = rootDir === "docs" ? "." : rootDir;
  const moduleDocIssues = findMissingModuleDocs(projectRoot);
  const sourceHeaderIssues = findMissingSourceHeaders(projectRoot);

  for (const issue of linkIssues) {
    process.stderr.write(`Broken link: ${issue.file} -> ${issue.target}\n`);
  }

  for (const issue of headingIssues) {
    process.stderr.write(
      `Heading mismatch: ${issue.file} en=${issue.englishHeadings} zh=${issue.chineseHeadings}\n`
    );
  }

  for (const issue of moduleDocIssues) {
    process.stderr.write(`Missing module doc: ${issue.directory}/${issue.file}\n`);
  }

  for (const issue of sourceHeaderIssues) {
    process.stderr.write(`Missing source header markers: ${issue.file} -> ${issue.missingMarkers.join(", ")}\n`);
  }

  if (
    linkIssues.length > 0 ||
    headingIssues.length > 0 ||
    moduleDocIssues.length > 0 ||
    sourceHeaderIssues.length > 0
  ) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Documentation checks passed.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

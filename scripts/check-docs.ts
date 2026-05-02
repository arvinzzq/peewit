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

  for (const issue of linkIssues) {
    process.stderr.write(`Broken link: ${issue.file} -> ${issue.target}\n`);
  }

  for (const issue of headingIssues) {
    process.stderr.write(
      `Heading mismatch: ${issue.file} en=${issue.englishHeadings} zh=${issue.chineseHeadings}\n`
    );
  }

  if (linkIssues.length > 0 || headingIssues.length > 0) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Documentation checks passed.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

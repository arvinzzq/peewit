import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const workspacePackages = [
  "packages/config",
  "packages/core",
  "packages/context",
  "packages/models",
  "packages/tools",
  "packages/permissions",
  "packages/skills",
  "packages/sessions"
] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("package boundaries", () => {
  test("declares the Phase 0 app and package workspaces", () => {
    const rootPackage = readJson("package.json") as {
      packageManager?: string;
    };
    const workspaceConfig = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");

    expect(rootPackage.packageManager).toMatch(/^pnpm@/);
    expect(workspaceConfig).toContain("  - apps/*");
    expect(workspaceConfig).toContain("  - packages/*");
    expect(readJson("apps/cli/package.json")).toMatchObject({
      name: "@arvinclaw/cli",
      private: true
    });

    for (const packagePath of workspacePackages) {
      const packageName = packagePath.replace("packages/", "@arvinclaw/");
      expect(readJson(`${packagePath}/package.json`)).toMatchObject({
        name: packageName,
        private: true
      });
    }
  });

  test("core packages do not depend on the CLI app", () => {
    for (const packagePath of workspacePackages) {
      const manifest = readJson(`${packagePath}/package.json`) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      expect(manifest.dependencies ?? {}).not.toHaveProperty("@arvinclaw/cli");
      expect(manifest.devDependencies ?? {}).not.toHaveProperty("@arvinclaw/cli");
    }
  });
});

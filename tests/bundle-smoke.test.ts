/**
 * Bundle smoke tests — run against the actual built dist/index.js and dist/web/server.js.
 * Catches runtime errors that unit tests on source files cannot detect:
 *   - main() never called (import.meta.url guard bug)
 *   - missing bundled dependencies (@hono/node-server, ws, etc.)
 *   - dynamic require() failures in ESM output
 *   - static file path mismatches
 *
 * Runs as part of `pnpm run check:bundle` (invoked by prepublishOnly).
 */
import { describe, test, expect, beforeAll } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const cliBin = join(root, "apps/cli/dist/index.js");
const webServer = join(root, "apps/cli/dist/web/server.js");
const pkgVersion = (JSON.parse(readFileSync(join(root, "apps/cli/package.json"), "utf8")) as { version: string }).version;

// Build once before all tests unless SKIP_BUILD=1 (set by build-release.sh to avoid recursion).
beforeAll(async () => {
  if (process.env["SKIP_BUILD"] === "1") return;
  await execFileAsync("bash", [join(root, "scripts/build-release.sh")], {
    env: { ...process.env, SKIP_BUILD: "1" },
    cwd: root,
    timeout: 180_000,
  });
}, 180_000);

// ─── helpers ──────────────────────────────────────────────────────────────────

function run(args: string[], opts: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile("node", [cliBin, ...args], { timeout: opts.timeout ?? 10_000 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: (err as NodeJS.ErrnoException & { code?: number } | null)?.code ?? 0 });
    });
  });
}

function startWebServer(port: number): Promise<{ kill: () => void; ready: Promise<void> }> {
  const proc = spawn("node", [webServer], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("web server did not start within 10s")), 10_000);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes("http://localhost")) {
        clearTimeout(timeout);
        proc.stdout.off("data", onData);
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`web server exited with code ${code}`));
    });
  });

  return Promise.resolve({ kill: () => proc.kill("SIGTERM"), ready });
}

// ─── CLI tests ────────────────────────────────────────────────────────────────

describe("bundle smoke — CLI", () => {
  test("--help exits 0 and shows usage", async () => {
    const { stdout, code } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: vole");
    expect(stdout).toContain("chat");
  });

  test("--version exits 0 and shows correct version", async () => {
    const { stdout, code } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkgVersion);
  });

  test("chat --help exits 0 without API key error", async () => {
    const { stdout, stderr, code } = await run(["chat", "--help"]);
    expect(code).toBe(0);
    expect(stderr).not.toContain("API key");
    expect(stdout).toContain("Start an interactive chat session");
  });

  test("sessions exits 0", async () => {
    const { code } = await run(["sessions"]);
    expect(code).toBe(0);
  });

  test("skills exits 0 and lists built-in skills", async () => {
    const { stdout, code } = await run(["skills"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Skills:");
    expect(stdout).toContain("[built-in]");
  });

  test("chat --fake runs a turn end-to-end without crashing", async () => {
    const { stdout, code } = await run(["chat", "--fake", "hello world"], { timeout: 15_000 });
    expect(code).toBe(0);
    expect(stdout).toContain("Fake response");
  });
});

// ─── Web tests ────────────────────────────────────────────────────────────────

describe("bundle smoke — web server", () => {
  test("server starts and GET /api/sessions returns JSON", async () => {
    const port = 13120;
    const { kill, ready } = await startWebServer(port);
    try {
      await ready;
      const res = await fetch(`http://localhost:${port}/api/sessions`);
      expect(res.ok).toBe(true);
      const body = await res.json() as { sessions: unknown[] };
      expect(Array.isArray(body.sessions)).toBe(true);
    } finally {
      kill();
    }
  }, 20_000);
});

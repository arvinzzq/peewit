/**
 * Real API integration test — exercises the core agent loop with OpenRouter.
 * Run via: pnpm run test:api
 * (env vars passed by the npm script from .env)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

import { loadConfig } from "../packages/config/src/index.ts";
import { DefaultContextAssembler } from "../packages/context/src/index.ts";
import { AgentRuntime, SessionMutex } from "../packages/core/src/index.ts";
import { OpenAICompatibleProvider, FakeModelProvider } from "../packages/models/src/index.ts";
import { DefaultPermissionPolicy } from "../packages/permissions/src/index.ts";
import {
  createReadFileTool,
  createListDirectoryTool,
  createWriteFileTool,
  createSearchFilesTool,
} from "../packages/tools/src/index.ts";

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Test runner ───────────────────────────────────────────────────────────────
interface TestResult {
  name: string; passed: boolean; note: string; events: string[]; durationMs: number;
}
const results: TestResult[] = [];

async function runTest(
  name: string,
  fn: () => Promise<{ passed: boolean; note: string; events: string[] }>
) {
  process.stdout.write(`  ${C.cyan("▶")} ${name} ... `);
  const start = Date.now();
  try {
    const { passed, note, events } = await fn();
    const dur = Date.now() - start;
    results.push({ name, passed, note, events, durationMs: dur });
    console.log(`${passed ? C.green("PASS") : C.red("FAIL")} ${C.dim(`(${dur}ms)`)}  ${note}`);
  } catch (err) {
    const dur = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, note: msg, events: [], durationMs: dur });
    console.log(`${C.red("FAIL")} ${C.dim(`(${dur}ms)`)}  ${msg}`);
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const config = loadConfig({ env: process.env });

function makeProvider() {
  return new OpenAICompatibleProvider({
    apiKey: config.secrets.apiKey ?? "",
    baseURL: config.model.baseURL,
    model: config.model.model,
  });
}

function makeRuntime(opts: {
  tools?: ConstructorParameters<typeof AgentRuntime>[0]["tools"];
  approvalResolver?: ConstructorParameters<typeof AgentRuntime>[0]["approvalResolver"];
  preferStreaming?: boolean;
  maxSteps?: number;
} = {}) {
  return new AgentRuntime({
    contextAssembler: new DefaultContextAssembler(),
    modelProvider: makeProvider(),
    permissionPolicy: new DefaultPermissionPolicy(),
    approvalResolver: opts.approvalResolver,
    tools: opts.tools ?? [],
    systemInstruction: "You are Peewit, a helpful assistant. Be concise.",
    runtime: { mode: "auto", workspace: process.cwd(), currentDate: new Date().toISOString().slice(0, 10) },
    preferStreaming: opts.preferStreaming ?? false,
    maxSteps: opts.maxSteps ?? 6,
  });
}

async function collectTurn(runtime: AgentRuntime, message: string) {
  const eventTypes: string[] = [];
  let assistantText = "";
  let failed = false;
  let failMsg = "";
  for await (const evt of runtime.runTurn({ message })) {
    eventTypes.push(evt.type);
    if (evt.type === "assistant_message_created") assistantText = evt.message.content;
    if (evt.type === "run_failed") { failed = true; failMsg = evt.error.message; }
  }
  return { eventTypes, assistantText, failed, failMsg };
}

// ── Header ────────────────────────────────────────────────────────────────────
console.log();
console.log(C.bold("Peewit — Real API Integration Tests"));
console.log(C.dim(`Provider : openai-compatible (OpenRouter)`));
console.log(C.dim(`Model    : ${config.model.model}`));
console.log(C.dim(`BaseURL  : ${config.model.baseURL}`));
console.log();

// ─── T1: Basic chat ───────────────────────────────────────────────────────────
await runTest("T1 · Basic chat — non-streaming", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime(), "Reply with exactly: hello world"
  );
  const required = ["run_started","context_assembled","model_request_started",
    "model_request_completed","assistant_message_created","run_completed"];
  const hasAll = required.every((e) => eventTypes.includes(e));
  const hasText = assistantText.toLowerCase().includes("hello");
  return {
    passed: !failed && hasAll && hasText,
    note: failed ? failMsg : hasAll && hasText
      ? `"${assistantText.slice(0, 60)}"`
      : `missing: ${required.filter((e) => !eventTypes.includes(e)).join(", ")}`,
    events: eventTypes,
  };
});

// ─── T2: Streaming ────────────────────────────────────────────────────────────
await runTest("T2 · Streaming — token_delta events fired", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime({ preferStreaming: true }),
    "Count from 1 to 5, one number per line."
  );
  const deltaCount = eventTypes.filter((e) => e === "token_delta").length;
  return {
    passed: !failed && deltaCount > 0 && assistantText.includes("1"),
    note: failed ? failMsg : `${deltaCount} token_delta events, reply length ${assistantText.length}`,
    events: eventTypes,
  };
});

// ─── T3: Tool call — list_directory ──────────────────────────────────────────
await runTest("T3 · Tool call — list_directory (low risk, auto-allow)", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime({ tools: [createListDirectoryTool()] }),
    "Use list_directory tool (path: '.') and reply in a single sentence what you found."
  );
  const toolCalled = eventTypes.includes("tool_call_requested");
  const permEval = eventTypes.includes("tool_call_permission_evaluated");
  const toolDone = eventTypes.includes("tool_completed");
  const stallFired = eventTypes.includes("planning_stall_detected");
  return {
    passed: !failed && toolCalled && permEval && toolDone && !stallFired,
    note: failed ? failMsg
      : stallFired
        ? `unexpected stall fired after tool_completed (regression)`
        : `tool events: ${eventTypes.filter(e => e.startsWith("tool_")).join(", ")}`,
    events: eventTypes,
  };
});

// ─── T4: Tool call — read_file ────────────────────────────────────────────────
await runTest("T4 · Tool call — read_file + answer from content", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime({ tools: [createReadFileTool()] }),
    "Read the file 'package.json' and tell me the project name."
  );
  const toolDone = eventTypes.includes("tool_completed");
  const mentionsPeewit = assistantText.toLowerCase().includes("peewit");
  return {
    passed: !failed && toolDone && mentionsPeewit,
    note: failed ? failMsg
      : `tool_completed=${toolDone}, mentions 'peewit'=${mentionsPeewit}  "${assistantText.slice(0,80)}"`,
    events: eventTypes,
  };
});

// ─── T5: Approval flow — permission system (fake tool call + real approval) ──
await runTest("T5 · Permission approval — confirm mode routes medium-risk through approval", async () => {
  const tmpFile = join(tmpdir(), `peewit-test-${Date.now()}.txt`);

  // Use fake model to reliably inject a write_file tool call
  const fakeProvider = new FakeModelProvider([
    {
      type: "tool_calls",
      calls: [{
        id: "call_1",
        name: "write_file",
        input: { path: tmpFile, content: "peewit test ok" }
      }]
    },
    { type: "message", content: "File written successfully." }
  ]);

  const approvalResolutions: string[] = [];
  const approvalResolver = {
    async resolve() {
      approvalResolutions.push("approved");
      return { approved: true, reason: "test" };
    }
  };

  const runtime = new AgentRuntime({
    contextAssembler: new DefaultContextAssembler(),
    modelProvider: fakeProvider,
    permissionPolicy: new DefaultPermissionPolicy(),
    approvalResolver,
    tools: [createWriteFileTool()],
    systemInstruction: "You are Peewit.",
    runtime: { mode: "confirm", workspace: process.cwd(), currentDate: new Date().toISOString().slice(0, 10) },
  });

  const { eventTypes, failed, failMsg } = await collectTurn(runtime, "Write a test file.");
  await rm(tmpFile, { force: true });

  const asked = eventTypes.includes("approval_requested");
  const resolved = eventTypes.includes("approval_resolved");
  const toolDone = eventTypes.includes("tool_completed");

  return {
    passed: asked && resolved && toolDone && approvalResolutions.length > 0,
    note: failed
      ? failMsg
      : `approval_requested=${asked}, resolved=${resolved}, tool_completed=${toolDone}`,
    events: eventTypes,
  };
});

// ─── T6: Multi-step tool use ─────────────────────────────────────────────────
await runTest("T6 · Multi-step — list then read (streaming)", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime({ tools: [createListDirectoryTool(), createReadFileTool()], preferStreaming: true }),
    "First list the root directory, then read README.md and give me its title in one sentence."
  );
  const toolStarts = eventTypes.filter((e) => e === "tool_started").length;
  return {
    passed: !failed && toolStarts >= 1 && assistantText.length > 10,
    note: failed ? failMsg : `${toolStarts} tool calls, reply: "${assistantText.slice(0, 80)}"`,
    events: eventTypes,
  };
});

// ─── T7: Planning stall detection (fake provider) ────────────────────────────
await runTest("T7 · Planning stall — detected and run terminates", async () => {
  const fakeProvider = new FakeModelProvider([
    { type: "message", content: "I'll start by planning: 1. Read the file. 2. Summarize it." },
    { type: "message", content: "I'll start by planning: 1. Read the file. 2. Summarize it." },
    { type: "message", content: "I'll start by planning: 1. Read the file. 2. Summarize it." },
  ]);
  const runtime = new AgentRuntime({
    contextAssembler: new DefaultContextAssembler(),
    modelProvider: fakeProvider,
    tools: [createReadFileTool()],
    systemInstruction: "You are Peewit.",
    maxPlanningStallRetries: 2,
  });
  const { eventTypes } = await collectTurn(runtime, "Read package.json and summarize it.");
  return {
    passed: eventTypes.includes("planning_stall_detected") && eventTypes.includes("run_failed"),
    note: `stall_detected=${eventTypes.includes("planning_stall_detected")}, run_failed=${eventTypes.includes("run_failed")}`,
    events: eventTypes,
  };
});

// ─── T8: Context assembly XML sections ───────────────────────────────────────
await runTest("T8 · Context assembly — XML sections built correctly", async () => {
  const assembler = new DefaultContextAssembler();
  const result = await assembler.assemble({
    systemInstruction: "You are Peewit.",
    runtime: { mode: "confirm", workspace: process.cwd(), currentDate: "2026-05-07" },
    tools: [{ name: "read_file", description: "Read a file.", risk: "low" }],
    permissionGuidance: "Low risk auto-approved.",
    userMessage: "Hello",
  });
  const sys = result.modelInput.messages[0]?.content ?? "";
  const hasXml = sys.includes("<identity>") && sys.includes("<runtime>") && sys.includes("<tooling>");
  const included = result.report.includedSections;
  return {
    passed: hasXml && included.includes("identity") && included.includes("runtime"),
    note: `sections: [${included.join(", ")}]  XML present: ${hasXml}`,
    events: [],
  };
});

// ─── T9b: search_files — real workspace search ───────────────────────────────
await runTest("T9b · search_files — finds real content in workspace", async () => {
  const { eventTypes, assistantText, failed, failMsg } = await collectTurn(
    makeRuntime({ tools: [createSearchFilesTool()] }),
    "Use search_files to find all TypeScript files that export 'AgentRuntime' (pattern: 'export class AgentRuntime') and tell me which file it's in."
  );
  const toolDone = eventTypes.includes("tool_completed");
  const mentionsCore = assistantText.toLowerCase().includes("core");
  return {
    passed: !failed && toolDone && mentionsCore,
    note: failed ? failMsg : `tool_completed=${toolDone}, mentions 'core'=${mentionsCore}  "${assistantText.slice(0, 100)}"`,
    events: eventTypes,
  };
});

// ─── T9: Session mutex ────────────────────────────────────────────────────────
await runTest("T9 · Session mutex — concurrent turns serialised", async () => {
  const mutex = new SessionMutex();
  const order: number[] = [];
  async function fakeTurn(id: number, delayMs: number) {
    const rel = await mutex.acquire("sess-test");
    await new Promise<void>((r) => setTimeout(r, delayMs));
    order.push(id);
    rel();
  }
  await Promise.all([fakeTurn(1, 30), fakeTurn(2, 10), fakeTurn(3, 5)]);
  return {
    passed: order[0] === 1 && order[1] === 2 && order[2] === 3,
    note: `execution order: [${order.join(", ")}]`,
    events: [],
  };
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
console.log(C.bold("─────────────────────────────────────────"));
const passCount = results.filter((r) => r.passed).length;
const failCount = results.filter((r) => !r.passed).length;
console.log(C.bold(`Results: ${C.green(`${passCount} passed`)}  ${failCount > 0 ? C.red(`${failCount} failed`) : C.dim("0 failed")}  / ${results.length} total`));

if (failCount > 0) {
  console.log();
  console.log(C.bold("Failed tests:"));
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ${C.red("✗")} ${r.name}`);
    console.log(`    ${C.dim(r.note)}`);
    if (r.events.length > 0) console.log(`    ${C.dim("events: " + r.events.join(" → "))}`);
  }
}
console.log();
process.exit(failCount > 0 ? 1 : 0);

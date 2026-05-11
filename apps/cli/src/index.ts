/**
 * INPUT: CLI args, config, model providers, skill loader, session/trace stores, taskflow store, built-in tools, optional fake outputs and line reader.
 * OUTPUT: Chat, approvals, tool execution, todos, skill subcommands, session/task/taskflow listings, daemon cron, trace, redacted config, stdout/stderr, GatewayCore admission for chat runs (global / subagent / session lanes), run --dream consolidation, session persistence of all turn messages and compaction boundaries.
 * POS: CLI adapter layer; translates terminal commands and approval prompts; submits chat runs to GatewayCore without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import "dotenv/config";
import { Command, type OptionValues } from "commander";
import { createInterface } from "node:readline";
import { readdir, readFile, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, resolveSessionsDirectory, type EffectiveConfig, type LoadConfigInput, type RedactedConfigView } from "@vole/config";
import { DefaultContextAssembler } from "@vole/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, createCheckSubagentTool, createSpawnSubagentAsyncTool, createSpawnSubagentTool, type ApprovalRequest, type ApprovalResolution, type ApprovalResolver, type RuntimeEvent, type RuntimeTraceStore, type SubagentFactory } from "@vole/core";
import { GatewayCore, type GatewaySession } from "@vole/gateway";
import { AnthropicProvider, FakeModelProvider, OpenAICompatibleProvider, type ModelInput, type ModelOutput, type ModelProvider } from "@vole/models";
import { CLI_CAPABILITIES, filterToolsByProfile, type ToolProfile } from "@vole/adapters";
import { BackgroundApprovalResolver, CronScheduler, JsonlTaskStore, writeHeartbeat, type HeartbeatState, type TaskDefinition, type TaskRunRecord } from "@vole/scheduler";
import { InMemorySessionStore, JsonlSessionStore, type SessionStore } from "@vole/sessions";
import { JsonlTaskFlowStore } from "@vole/taskflow";
import { SkillLoader, SkillManager, toSkillSummary, type SkillDefinition } from "@vole/skills";
import { createAppendDailyMemoryTool, createAppendFileTool, createEditFileTool, createListDirectoryTool, createLoadSkillTool, createMemoryGetTool, createMemorySearchTool, createReadFileTool, createReadWebPageTool, createSearchFilesTool, createShellTool, createUpdateHeartbeatTool, createWriteFileTool, type SkillFileMap } from "@vole/tools";

export const cliPackageName = "@vole/cli";

// Read ~/.vole/config.json (user) and ./vole.config.json (project) if present,
// and merge them into loadConfig. This makes the global install work without
// requiring users to set shell env vars — they can just write a config file.
async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

// Walk up from cwd looking for a .git directory; returns that directory or undefined.
async function findGitRoot(from: string = process.cwd()): Promise<string | undefined> {
  let dir = from;
  while (true) {
    try {
      await stat(join(dir, ".git"));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
}

async function loadCliConfig(options: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<EffectiveConfig> {
  const env = options.env ?? process.env as Record<string, string | undefined>;
  const home = env.HOME ?? process.env.HOME;
  const input: LoadConfigInput = { env };
  if (home !== undefined) {
    input.userConfig = await readJsonFile(join(home, ".vole", "config.json"));
  }
  input.projectConfig = await readJsonFile(join("vole.config.json"));

  const config = loadConfig(input);

  // Project-scoped sessions: store in <git-root>/.vole/sessions when inside a git repo.
  // Falls back to ~/.vole/sessions (the default) when not in a project.
  if (config.sessions.directory === "~/.vole/sessions") {
    const gitRoot = await findGitRoot(options.cwd);
    if (gitRoot !== undefined) {
      config.sessions.directory = join(gitRoot, ".vole", "sessions");
    }
  }

  return config;
}

// Core system instruction — adapted from OpenClaw's execution bias section.
// Loaded as the <identity> XML section; workspace files (SOUL.md, AGENTS.md)
// are loaded into the <workspace> section on top of this.
const AGENT_SYSTEM_INSTRUCTION = `\
You are Vole, a capable coding and general-purpose agent.

## Tool Call Style
Do not narrate routine, low-risk tool calls — just call the tool.
Narrate only when it genuinely helps: multi-step work, sensitive actions, or when explaining a non-obvious choice.
Keep narration brief; avoid restating what tool output already shows.

## Execution Bias
- Pure conversational message (greeting, capability question, clarification): reply directly; do not call tools.
- Actionable request: act in this turn, do not describe what you plan to do.
- Non-final turn: use tools to advance, or ask for the one decision that blocks safe progress.
- Continue until done or genuinely blocked; do not end with a plan or promise when tools can move work forward.
- Weak or empty tool result: vary the query, path, command, or source before concluding.
- Mutable facts require live checks: files, git state, versions, running processes, package state.
- Final answer requires evidence: test output, lint result, file inspection, or a named concrete blocker.
- Longer work: brief progress note, then keep going.

## File Editing
- Modify existing code: edit_file (precise string replacement, preserves surrounding content).
- Add to end of file: append_file.
- Create new files or intentional full replacement: write_file.`;

/** Module-level GatewayCore singleton — tracks active CLI sessions and admits every chat run through global / subagent / session lanes. */
const cliGateway = new GatewayCore();

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  fakeModelOutputs?: ModelOutput[];
  fetch?: FetchLike;
  readLine?: (prompt: string) => Promise<string | undefined>;
  sessionsDirectory?: string;
  write?: (text: string) => void;
}

export async function runCli(args: string[], packageVersion: string, options: RunCliOptions = {}): Promise<CliResult> {
  // Bare invocation (no args, or only "--" separator) → default to interactive chat
  const effectiveArgs = args[0] === "--" ? args.slice(1) : args;
  if (effectiveArgs.length === 0) {
    return runInteractiveConfiguredChat(options, { fakeInteractive: false, resume: false });
  }

  let capturedOut = "";
  let actionResult: CliResult | null = null;

  const program = new Command()
    .name("vole")
    .description("A capable coding and general-purpose agent.")
    .version(packageVersion, "-v, --version", "Show version number")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => { capturedOut += str; },
      writeErr: (str) => { capturedOut += str; },
    })
    .addHelpText("after", "\nRun `vole <command> --help` for command-specific options.");

  // ── chat ──────────────────────────────────────────────────────────────────
  program.command("chat")
    .description("Start an interactive chat session")
    .argument("[extra...]", "Slash commands to run after a --fake turn")
    .option("-s, --session <id>", "Continue a named session")
    .option("-r, --resume", "Continue the most recently updated session")
    .option("--fake <message>", "Run one turn with a fake provider and exit")
    .option("--fake-interactive", "Interactive chat with a fake provider")
    .action(async (extra: string[], opts: OptionValues) => {
      const slashCmds = (extra as string[]).filter((a) => a.startsWith("/"));
      if (opts["fake"] !== undefined) {
        actionResult = await runFakeChatTurn({ message: opts["fake"] as string, slashCommands: slashCmds }, options);
        return;
      }
      if (opts["fakeInteractive"]) {
        const sid = typeof opts["session"] === "string" ? opts["session"] : undefined;
        actionResult = await runInteractiveFakeChat(options, {
          fakeInteractive: true, resume: false, ...(sid !== undefined ? { sessionId: sid } : {})
        });
        return;
      }
      const sid = typeof opts["session"] === "string" ? opts["session"] : undefined;
      actionResult = await runInteractiveConfiguredChat(options, {
        fakeInteractive: false,
        resume: opts["resume"] === true,
        ...(sid !== undefined ? { sessionId: sid } : {})
      });
    });

  // ── sessions ──────────────────────────────────────────────────────────────
  program.command("sessions")
    .description("List stored chat sessions")
    .action(async () => { actionResult = await runListSessions(options); });

  // ── run ───────────────────────────────────────────────────────────────────
  program.command("run")
    .description('Run a one-shot background task  e.g. vole run "fix the tests"')
    .argument("[goal]", "Goal for the task")
    .option("--mode <mode>", "Autonomy mode: auto | confirm | observe", "confirm")
    .option("--dream", "Consolidate daily memory notes into MEMORY.md")
    .action(async (goal: string | undefined, opts: OptionValues) => {
      if (opts["dream"]) { actionResult = await runMemoryDreaming(options); return; }
      const g = (goal ?? "").trim();
      if (g === "") {
        actionResult = { exitCode: 1, stdout: "", stderr: 'Missing goal. Usage: vole run "<goal>"\n' };
        return;
      }
      const raw = opts["mode"] as string;
      const mode: "auto" | "confirm" | "observe" = raw === "auto" ? "auto" : raw === "observe" ? "observe" : "confirm";
      actionResult = await runBackgroundTask(g, mode, options);
    });

  // ── tasks ─────────────────────────────────────────────────────────────────
  program.command("tasks")
    .description("List recent background task runs")
    .option("-n, --limit <n>", "Number of runs to show", (v) => parseInt(v, 10))
    .action(async (opts: OptionValues) => {
      actionResult = await runListTasks(options, opts["limit"] as number | undefined);
    });

  // ── skills ────────────────────────────────────────────────────────────────
  const skillsCmd = program.command("skills").description("Manage agent skills");
  skillsCmd.action(async () => { actionResult = await runSkillsList(options); });
  skillsCmd.command("install <path>").description("Install a skill from a local .md file")
    .action(async (p: string) => { actionResult = await runSkillsInstall(p, options); });
  skillsCmd.command("enable <name>").description("Enable a disabled skill")
    .action(async (n: string) => { actionResult = await runSkillsLifecycle("enable", n, options); });
  skillsCmd.command("disable <name>").description("Disable a skill")
    .action(async (n: string) => { actionResult = await runSkillsLifecycle("disable", n, options); });
  skillsCmd.command("trust <name>").description("Mark an installed skill as trusted")
    .action(async (n: string) => { actionResult = await runSkillsLifecycle("trust", n, options); });
  skillsCmd.command("review <name>").description("Show full skill metadata and permissions")
    .action(async (n: string) => { actionResult = await runSkillsReview(n, options); });

  // ── daemon ────────────────────────────────────────────────────────────────
  program.command("daemon")
    .description("Start the task scheduler daemon")
    .option("--once", "Run all due tasks once and exit")
    .action(async (opts: OptionValues) => {
      actionResult = await runDaemon(options, opts["once"] === true);
    });

  // ── web ───────────────────────────────────────────────────────────────────
  program.command("web")
    .description("Start the Vole web dashboard")
    .option("-p, --port <port>", "Port to listen on", "3120")
    .option("--no-open", "Don't open the browser automatically")
    .action(async (opts: OptionValues) => {
      const port = parseInt(opts["port"] as string, 10) || 3120;
      const openBrowser = opts["open"] !== false;
      actionResult = await runWebDashboard(port, openBrowser);
    });

  // ── gateway ───────────────────────────────────────────────────────────────
  const gwCmd = program.command("gateway").description("Inspect run admission and active sessions");
  gwCmd.action(async () => { actionResult = await runGatewayStatus(options); });
  gwCmd.command("status").description("Show lane occupancy and active runs across processes")
    .action(async () => { actionResult = await runGatewayStatus(options); });

  // ── taskflow ──────────────────────────────────────────────────────────────
  const tfCmd = program.command("taskflow").description("Inspect cross-session task records");
  tfCmd.action(async () => { actionResult = await runTaskflowList(options, undefined); });
  tfCmd.command("list").description("List recent task records")
    .option("-n, --limit <n>", "Number of records to show", (v) => parseInt(v, 10))
    .action(async (opts: OptionValues) => { actionResult = await runTaskflowList(options, opts["limit"] as number | undefined); });
  tfCmd.command("show <id>").description("Show details of a task")
    .action(async (id: string) => { actionResult = await runTaskflowShow(id, options); });
  tfCmd.command("cancel <id>").description("Mark a task as cancelled")
    .action(async (id: string) => { actionResult = await runTaskflowCancel(id, options); });

  try {
    // Strip a leading "--" separator inserted by pnpm/npm run scripts so that
    // options like --no-open are not mistaken for positional arguments.
    const commanderArgs = args[0] === "--" ? args.slice(1) : args;
    await program.parseAsync(commanderArgs, { from: "user" });
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      const code = (err as { code: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.version") {
        return { exitCode: 0, stdout: capturedOut, stderr: "" };
      }
      if (code === "commander.unknownCommand") {
        const match = err.message.match(/unknown command '(.+)'/);
        const cmdName = match ? match[1] : (args[0] ?? "unknown");
        return { exitCode: 1, stdout: program.helpInformation(), stderr: `Unknown command "${cmdName}".\n` };
      }
      return { exitCode: (err as { exitCode?: number }).exitCode ?? 1, stdout: capturedOut, stderr: `${err.message}\n` };
    }
    throw err;
  }

  return actionResult ?? { exitCode: 0, stdout: capturedOut, stderr: "" };
}

interface ParsedFakeChatArgs {
  message: string;
  slashCommands: string[];
}

interface ParsedChatArgs {
  fakeInteractive: boolean;
  resume: boolean;
  sessionId?: string;
}

async function runFakeChatTurn(input: ParsedFakeChatArgs, options: RunCliOptions): Promise<CliResult> {
  const { message, slashCommands } = input;

  if (message.trim() === "") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing message for `chat --fake`.\n"
    };
  }

  const session = await CliChatSession.createFake(`Fake response to: ${message}`, options);
  const turn = await session.sendMessage(message);
  const commandOutput = await renderSlashCommands(session, slashCommands);
  const assistantText = turn.assistantText;
  const events = turn.events;
  const traceLines = renderCompactTrace(events).join("\n");

  return {
    exitCode: events.some((event) => event.type === "run_failed") ? 1 : 0,
    stdout: `Assistant: ${assistantText}\n\nTrace:\n${traceLines}\n${commandOutput}`,
    stderr: ""
  };
}

async function runInteractiveFakeChat(options: RunCliOptions, args: ParsedChatArgs): Promise<CliResult> {
  const session = await CliChatSession.createFake((message) => `Fake response to: ${message}`, options, {
    ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId })
  });

  return runInteractiveLoop(session, "Vole chat (fake provider)", options);
}

async function runInteractiveConfiguredChat(options: RunCliOptions, args: ParsedChatArgs): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "No API key configured. Add one to ~/.vole/config.json or set VOLE_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your shell.\n"
    };
  }

  if (args.resume && args.sessionId !== undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Use either `chat --resume` or `chat --session <id>`, not both.\n"
    };
  }

  const resumedSessionId = args.resume ? await findMostRecentSessionId(config, options) : undefined;

  if (args.resume && resumedSessionId === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "No stored sessions to resume. Start one with `vole chat` or `vole chat --session <id>`.\n"
    };
  }

  const sessionId = args.sessionId ?? resumedSessionId;

  return runInteractiveLoop(
    await CliChatSession.createConfigured(config, options, {
      ...(sessionId === undefined ? {} : { sessionId })
    }),
    resumedSessionId === undefined ? "Vole chat" : `Vole chat\nResumed session: ${resumedSessionId}`,
    options
  );
}

async function runListSessions(options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const store = createConfiguredSessionStore(config, options, createSessionId());
  const sessions = await store.listSessions();

  if (sessions.length === 0) {
    return {
      exitCode: 0,
      stdout: "Sessions:\nNo sessions found.\n",
      stderr: ""
    };
  }

  return {
    exitCode: 0,
    stdout: ["Sessions:", ...sessions.map((session) => `${session.id}\t${session.updatedAt}${session.title ? `\t${session.title}` : ""}`)].join("\n") + "\n",
    stderr: ""
  };
}

async function runGatewayStatus(options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const directory = resolveSessionsDirectory(effectiveConfig, options.env);

  const lines: string[] = ["Gateway status:", ""];

  // In-process view: this CLI invocation's own gateway.
  // For a standalone `vole gateway status` call this is usually empty; for a long-running
  // CliChatSession or vole daemon, this reflects the active state of that process.
  const inProc = cliGateway.status();
  lines.push("In-process (this CLI invocation):");
  lines.push(`  Lanes: global ${inProc.lanes.global.active}/${cliGateway.defaultLaneConcurrency.global} (queued ${inProc.lanes.global.queued}), subagent ${inProc.lanes.subagent.active}/${cliGateway.defaultLaneConcurrency.subagent} (queued ${inProc.lanes.subagent.queued}), sessions=${inProc.lanes.sessions.length}`);
  if (inProc.activeRuns.length === 0) {
    lines.push("  Active runs: (none)");
  } else {
    lines.push("  Active runs:");
    for (const run of inProc.activeRuns) {
      lines.push(`    ${run.runId} → ${run.sessionKey}${run.isSubagent ? " [subagent]" : ""} (started ${run.startedAt})`);
    }
  }
  lines.push("");

  // Cross-process view: scan the sessions directory for .lock sidecars.
  lines.push(`Cross-process session locks under ${directory}:`);
  let lockEntries: string[] = [];
  try {
    const entries = await readdir(directory);
    lockEntries = entries.filter((e) => e.endsWith(".lock"));
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      lines.push("  (sessions directory does not exist yet)");
      return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
    }
    throw error;
  }
  if (lockEntries.length === 0) {
    lines.push("  (no active locks)");
  } else {
    const now = Date.now();
    for (const entry of lockEntries.sort()) {
      const sessionId = entry.slice(0, -".lock".length);
      const path = join(directory, entry);
      let body: { pid?: number; startedAt?: number } = {};
      let mtime: Stats | undefined;
      try {
        body = JSON.parse(await readFile(path, "utf8")) as typeof body;
        mtime = await stat(path);
      } catch {
        lines.push(`  ${sessionId} — (lock file unreadable)`);
        continue;
      }
      const pid = typeof body.pid === "number" ? body.pid : undefined;
      const alive = pid !== undefined ? isPidAlive(pid) : false;
      const ageMs = typeof body.startedAt === "number" ? now - body.startedAt : (mtime ? now - mtime.mtimeMs : undefined);
      const ageStr = ageMs === undefined ? "?" : `${Math.round(ageMs / 100) / 10}s`;
      const pidStr = pid === undefined ? "?" : `pid ${pid} (${alive ? "alive" : "stale"})`;
      lines.push(`  ${sessionId} — ${pidStr}, held ${ageStr}`);
    }
  }

  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function runMemoryDreaming(options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "No API key configured. Add one to ~/.vole/config.json or set VOLE_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your shell.\n"
    };
  }

  if (config.memory.longTermFiles !== "write") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Memory dreaming requires VOLE_LONG_TERM_MEMORY=write\n"
    };
  }

  const dreamGoal = `You are a memory consolidation agent.
Review the recent daily memory files and the current MEMORY.md in the workspace.
Identify key facts, decisions, and patterns worth preserving long-term.
Append a consolidation summary to MEMORY.md using the write_file tool.
Be concise and factual. Do not duplicate what is already in MEMORY.md.`;

  return runBackgroundTask(dreamGoal, "auto", options);
}

async function runBackgroundTask(
  goal: string,
  mode: "observe" | "confirm" | "auto",
  options: RunCliOptions
): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "No API key configured. Add one to ~/.vole/config.json or set VOLE_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your shell.\n"
    };
  }

  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  const sessionId = createSessionId();
  const taskRunId = `task_${crypto.randomUUID()}`;
  const taskName = goal.slice(0, 40).replace(/\s+/g, "-").replace(/[^A-Za-z0-9-]/g, "").toLowerCase() || "task";
  const startedAt = new Date().toISOString();

  const sessionStore = new JsonlSessionStore({
    directory: sessionsDir,
    createSessionId: () => sessionId
  });
  const taskStore = new JsonlTaskStore(join(sessionsDir, "task-runs.jsonl"));

  const initialRecord: TaskRunRecord = {
    id: taskRunId,
    taskName,
    goal,
    sessionId,
    startedAt,
    status: "running",
    assistantText: ""
  };
  await taskStore.saveRun(initialRecord);

  const configuredProvider = createConfiguredProvider(config, options);
  const approvalResolver = new BackgroundApprovalResolver(mode);
  const currentDate = new Date().toISOString().slice(0, 10);

  const backgroundTools = (() => {
    const allTools = createCliBuiltInTools(options, config);
    return config.runtime.toolProfile !== undefined
      ? filterToolsByProfile(allTools, config.runtime.toolProfile as ToolProfile)
      : allTools;
  })();

  const runtime = new AgentRuntime({
    contextAssembler: createCliContextAssembler(config),
    modelProvider: configuredProvider,
    systemInstruction: AGENT_SYSTEM_INSTRUCTION,
    runtime: {
      mode,
      workspace: config.workspace.root,
      currentDate
    },
    tools: backgroundTools,
    preferStreaming: false,
    approvalResolver,
    maxSteps: 20,
    ...(config.runtime.promptMode !== undefined ? { promptMode: config.runtime.promptMode } : {})
  });

  const events: RuntimeEvent[] = [];
  await sessionStore.createSession({ title: `task: ${goal.slice(0, 60)}` });

  for await (const event of runtime.runTurn({ sessionId, message: goal })) {
    await sessionStore.appendTraceEvent({ sessionId, event });
    events.push(event);
  }

  const traceLines = renderCompactTrace(events);
  const assistantMessageEvent = events.find((e) => e.type === "assistant_message_created");
  const assistantText =
    assistantMessageEvent?.type === "assistant_message_created"
      ? assistantMessageEvent.message.content
      : "No assistant message was produced.";

  const failedEvent = events.find((e) => e.type === "run_failed");
  const status = failedEvent ? "failed" : "completed";
  const completedAt = new Date().toISOString();

  const updates: Partial<TaskRunRecord> = {
    status,
    assistantText,
    completedAt,
    ...(failedEvent?.type === "run_failed" ? { errorMessage: failedEvent.error.message } : {})
  };
  await taskStore.updateRun(taskRunId, updates);

  const traceOutput = traceLines.join("\n");
  const resultLine = status === "completed" ? `Done: ${assistantText}` : `Failed: ${failedEvent?.type === "run_failed" ? failedEvent.error.message : "Unknown error"}`;

  return {
    exitCode: status === "completed" ? 0 : 1,
    stdout: `Trace:\n${traceOutput}\n\n${resultLine}\n`,
    stderr: ""
  };
}

async function runListTasks(options: RunCliOptions, limit?: number): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  const taskStore = new JsonlTaskStore(join(sessionsDir, "task-runs.jsonl"));

  const runs = await taskStore.listRuns(limit !== undefined ? { limit } : {});

  if (runs.length === 0) {
    return {
      exitCode: 0,
      stdout: "No task runs found.\n",
      stderr: ""
    };
  }

  const lines = runs.map((run) => {
    const idSuffix = run.id.slice(-8);
    return `${idSuffix}  ${run.taskName}  ${run.status}  ${run.startedAt}`;
  });

  return {
    exitCode: 0,
    stdout: lines.join("\n") + "\n",
    stderr: ""
  };
}

async function loadTaskDefinitions(tasksDir: string): Promise<TaskDefinition[] | null> {
  // Returns null if the tasks directory does not exist
  try {
    await stat(tasksDir);
  } catch {
    return null;
  }

  const entries = await readdir(tasksDir);
  const taskFiles = entries.filter((e) => e.endsWith(".task.json"));
  const tasks: TaskDefinition[] = [];

  for (const file of taskFiles) {
    const content = await readFile(join(tasksDir, file), "utf8");
    tasks.push(JSON.parse(content) as TaskDefinition);
  }

  return tasks;
}

async function runDaemonTask(
  task: TaskDefinition,
  config: EffectiveConfig,
  options: RunCliOptions,
  taskStore: JsonlTaskStore
): Promise<void> {
  const runId = `run_${crypto.randomUUID()}`;
  const sessionId = createSessionId();
  const mode = task.mode ?? "auto";
  const record: TaskRunRecord = {
    id: runId,
    taskName: task.name,
    goal: task.goal,
    sessionId,
    startedAt: new Date().toISOString(),
    status: "running",
    assistantText: ""
  };
  await taskStore.saveRun(record);

  const heartbeatPath = join(config.workspace.root, "HEARTBEAT.md");
  const startHeartbeat: HeartbeatState = {
    status: "running",
    taskName: task.name,
    runId,
    lastUpdatedAt: new Date().toISOString()
  };
  await writeHeartbeat(heartbeatPath, startHeartbeat);

  const provider = options.fakeModelOutputs
    ? new FakeModelProvider(options.fakeModelOutputs)
    : createConfiguredProvider(config, options);
  const approvalResolver = new BackgroundApprovalResolver(mode);
  const currentDate = new Date().toISOString().slice(0, 10);

  const backgroundTools = (() => {
    const allTools = createCliBuiltInTools(options, config);
    return config.runtime.toolProfile !== undefined
      ? filterToolsByProfile(allTools, config.runtime.toolProfile as ToolProfile)
      : allTools;
  })();

  const runtime = new AgentRuntime({
    contextAssembler: createCliContextAssembler(config),
    modelProvider: provider,
    systemInstruction: AGENT_SYSTEM_INSTRUCTION,
    runtime: {
      mode,
      workspace: config.workspace.root,
      currentDate
    },
    tools: backgroundTools,
    preferStreaming: false,
    approvalResolver,
    ...(task.maxSteps !== undefined ? { maxSteps: task.maxSteps } : {}),
    ...(config.runtime.promptMode !== undefined ? { promptMode: config.runtime.promptMode } : {})
  });

  const events: RuntimeEvent[] = [];

  for await (const event of runtime.runTurn({ sessionId, message: task.goal })) {
    events.push(event);
  }

  const assistantMessageEvent = events.find((e) => e.type === "assistant_message_created");
  const assistantText =
    assistantMessageEvent?.type === "assistant_message_created"
      ? assistantMessageEvent.message.content
      : "No assistant message was produced.";

  const failedEvent = events.find((e) => e.type === "run_failed");
  const status = failedEvent ? "failed" : "completed";

  const completedAt = new Date().toISOString();
  const updates: Partial<TaskRunRecord> = {
    status,
    assistantText,
    completedAt,
    ...(failedEvent?.type === "run_failed" ? { errorMessage: failedEvent.error.message } : {})
  };
  await taskStore.updateRun(runId, updates);

  const endHeartbeat: HeartbeatState = {
    status,
    taskName: task.name,
    runId,
    lastUpdatedAt: completedAt,
    ...(failedEvent?.type === "run_failed" ? { message: `Error: ${failedEvent.error.message}` } : {})
  };
  await writeHeartbeat(heartbeatPath, endHeartbeat);
}

async function runDaemon(options: RunCliOptions, once: boolean): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "No API key configured. Add one to ~/.vole/config.json or set VOLE_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your shell.\n"
    };
  }

  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  const tasksDir = join(dirname(sessionsDir), "tasks");
  const taskStore = new JsonlTaskStore(join(sessionsDir, "task-runs.jsonl"));

  const tasks = await loadTaskDefinitions(tasksDir);
  if (tasks === null) {
    return {
      exitCode: 0,
      stdout: `No tasks directory found at ${tasksDir}.\n`,
      stderr: ""
    };
  }

  const cronTasks = tasks.filter((t) => t.cron !== undefined);

  if (once) {
    const now = new Date();
    const output: string[] = [];
    for (const task of cronTasks) {
      output.push(`Running: ${task.name}`);
      await runDaemonTask(task, config, options, taskStore);
    }
    output.push("Done.");
    return {
      exitCode: 0,
      stdout: output.join("\n") + "\n",
      stderr: ""
    };
  }

  // Continuous daemon mode: start scheduler and wait for SIGTERM/SIGINT
  const runner = async (task: TaskDefinition) => {
    await runDaemonTask(task, config, options, taskStore);
  };

  const scheduler = new CronScheduler(cronTasks, runner);
  scheduler.start();

  return new Promise<CliResult>((resolve) => {
    const shutdown = () => {
      scheduler.stop();
      resolve({
        exitCode: 0,
        stdout: "Daemon stopped.\n",
        stderr: ""
      });
    };

    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

async function resolveTaskflowFilePath(options: RunCliOptions): Promise<string> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  return join(dirname(sessionsDir), "taskflow.jsonl");
}

async function runTaskflowList(options: RunCliOptions, limit?: number): Promise<CliResult> {
  const filePath = await resolveTaskflowFilePath(options);
  const store = new JsonlTaskFlowStore(filePath);
  const records = await store.list(limit !== undefined ? { limit } : {});

  if (records.length === 0) {
    return {
      exitCode: 0,
      stdout: "No task records found.\n",
      stderr: ""
    };
  }

  const lines = records.map((r) => {
    const idSuffix = r.id.slice(-8);
    return `${idSuffix}  ${r.status}  ${r.runtime}  ${r.createdAt}  ${r.task.slice(0, 60)}`;
  });

  return {
    exitCode: 0,
    stdout: ["Task records:", ...lines].join("\n") + "\n",
    stderr: ""
  };
}

async function runTaskflowShow(id: string, options: RunCliOptions): Promise<CliResult> {
  const filePath = await resolveTaskflowFilePath(options);
  const store = new JsonlTaskFlowStore(filePath);
  const record = await store.get(id);

  if (record === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Task "${id}" not found.\n`
    };
  }

  const lines = [
    `ID:               ${record.id}`,
    `Runtime:          ${record.runtime}`,
    `Status:           ${record.status}`,
    `Task:             ${record.task}`,
    `Created:          ${record.createdAt}`,
    `Updated:          ${record.updatedAt}`,
    ...(record.parentId !== undefined ? [`Parent:           ${record.parentId}`] : []),
    ...(record.sessionId !== undefined ? [`Session:          ${record.sessionId}`] : []),
    ...(record.progressSummary !== undefined ? [`Progress:         ${record.progressSummary}`] : []),
    ...(record.terminalSummary !== undefined ? [`Terminal summary: ${record.terminalSummary}`] : [])
  ];

  return {
    exitCode: 0,
    stdout: lines.join("\n") + "\n",
    stderr: ""
  };
}

async function runTaskflowCancel(id: string, options: RunCliOptions): Promise<CliResult> {
  const filePath = await resolveTaskflowFilePath(options);
  const store = new JsonlTaskFlowStore(filePath);
  const updated = await store.update(id, { status: "cancelled" });

  if (updated === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Task "${id}" not found.\n`
    };
  }

  return {
    exitCode: 0,
    stdout: `Cancelled: ${id}\n`,
    stderr: ""
  };
}

function resolveSkillsDirectory(config: EffectiveConfig, options: RunCliOptions): string {
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  return join(dirname(sessionsDir), "skills");
}

async function runSkillsList(options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const skillsDir = resolveSkillsDirectory(config, options);
  const loader = new SkillLoader();
  const skills = await loader.load({
    workspaceRoot: config.workspace.root,
    userSkillsDir: skillsDir
  });

  const lines = renderSkillIndex(skills);

  return {
    exitCode: 0,
    stdout: ["Skills:", ...lines].join("\n") + "\n",
    stderr: ""
  };
}

async function runSkillsInstall(sourcePath: string, options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const skillsDir = resolveSkillsDirectory(config, options);
  const manager = new SkillManager(skillsDir);

  try {
    const entry = await manager.install(sourcePath);
    return {
      exitCode: 0,
      stdout: `Installed: ${entry.name}\n`,
      stderr: ""
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Failed to install skill: ${error instanceof Error ? error.message : String(error)}\n`
    };
  }
}

async function runSkillsLifecycle(
  action: "enable" | "disable" | "trust",
  name: string,
  options: RunCliOptions
): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const skillsDir = resolveSkillsDirectory(config, options);
  const manager = new SkillManager(skillsDir);

  try {
    if (action === "enable") {
      await manager.enable(name);
      return { exitCode: 0, stdout: `Enabled: ${name}\n`, stderr: "" };
    } else if (action === "disable") {
      await manager.disable(name);
      return { exitCode: 0, stdout: `Disabled: ${name}\n`, stderr: "" };
    } else {
      await manager.trust(name);
      return { exitCode: 0, stdout: `Trusted: ${name}\n`, stderr: "" };
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Failed to ${action} skill: ${error instanceof Error ? error.message : String(error)}\n`
    };
  }
}

async function runSkillsReview(name: string, options: RunCliOptions): Promise<CliResult> {
  const config = await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
  const skillsDir = resolveSkillsDirectory(config, options);
  const manager = new SkillManager(skillsDir);

  const def = await manager.review(name);
  if (def === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Skill "${name}" not found.\n`
    };
  }

  const entries = await manager.listEntries();
  const entry = entries.find((e) => e.name === name);

  const lines = [
    `Name:         ${def.name}`,
    `Source:       ${def.source}`,
    ...(def.version !== undefined ? [`Version:      ${def.version}`] : []),
    ...(def.origin !== undefined ? [`Origin:       ${def.origin}`] : []),
    `Permissions:  ${def.permissions !== undefined && def.permissions.length > 0 ? def.permissions.join(", ") : "(none)"}`,
    `Trusted:      ${String(def.trusted ?? false)}`,
    `Enabled:      ${String(def.enabled ?? true)}`,
    ...(entry?.installedAt !== undefined ? [`Installed:    ${entry.installedAt}`] : []),
    "",
    "--- Body ---",
    def.body
  ];

  return {
    exitCode: 0,
    stdout: lines.join("\n") + "\n",
    stderr: ""
  };
}

async function findMostRecentSessionId(config: EffectiveConfig, options: RunCliOptions): Promise<string | undefined> {
  const store = createConfiguredSessionStore(config, options, createSessionId());
  const [session] = await store.listSessions({ limit: 1 });

  return session?.id;
}

async function runInteractiveLoop(session: CliChatSession, title: string, options: RunCliOptions): Promise<CliResult> {
  const output: string[] = [];
  const emit = (...lines: string[]) => {
    if (options.write) {
      options.write(`${lines.join("\n")}\n`);
    } else {
      output.push(...lines);
    }
  };

  emit(title, "Type /help for commands or /exit to leave.", "");

  while (true) {
    const line = await options.readLine?.("> ");

    if (line === undefined) {
      break;
    }

    const message = line.trim();

    if (message === "") {
      continue;
    }

    if (message === "/exit") {
      emit("Goodbye.");
      break;
    }

    if (message === "/help") {
      emit(...renderInteractiveHelp(), "");
      continue;
    }

    if (message === "/clear") {
      emit("(conversation display cleared)", "");
      continue;
    }

    if (message.startsWith("/")) {
      emit(...renderInteractiveSlashCommand(message, await session.runSlashCommand(message)), "");
      continue;
    }

    const turn = await session.sendMessage(message);
    if (turn.todosLines.length > 0) {
      emit(...turn.todosLines, "");
    }
    if (turn.approvalLines.length > 0) {
      emit(...turn.approvalLines, "");
    }
    emit(`Assistant: ${turn.assistantText}`, "");
  }

  return {
    exitCode: 0,
    stdout: options.write ? "" : `${output.join("\n")}\n`,
    stderr: ""
  };
}

const SLASH_COMMAND_LABELS: Record<string, string> = {
  "/trace":  "Recent Trace:",
  "/config": "Config:",
  "/skills": "Skills:",
  "/help":   "Commands:",
};

async function renderSlashCommands(session: CliChatSession, slashCommands: string[]): Promise<string> {
  const rendered: string[] = [];

  for (const command of slashCommands) {
    const label = SLASH_COMMAND_LABELS[command];
    if (label !== undefined) {
      rendered.push(["", label, ...(await session.runSlashCommand(command))].join("\n"));
    } else {
      rendered.push(["", `Unknown slash command: ${command}`].join("\n"));
    }
  }

  return rendered.length === 0 ? "" : `${rendered.join("\n")}\n`;
}

function renderInteractiveSlashCommand(command: string, lines: string[]): string[] {
  if (lines[0]?.startsWith("Unknown slash command")) {
    return lines;
  }
  const label = SLASH_COMMAND_LABELS[command];
  return label !== undefined ? [label, ...lines] : lines;
}

function renderInteractiveHelp(): string[] {
  return [
    "Commands:",
    "/help    Show commands",
    "/trace   Show recent trace events",
    "/config  Show redacted configuration",
    "/skills  List loaded skills",
    "/clear   Clear conversation display",
    "/exit    Leave chat"
  ];
}

export interface CliChatTurnResult {
  assistantText: string;
  approvalLines: string[];
  todosLines: string[];
  events: RuntimeEvent[];
}

export interface CreateChatSessionOptions {
  sessionId?: string;
  preferStreaming?: boolean;
  approvalResolver?: ApprovalResolver;
}

export type { ApprovalRequest, ApprovalResolution };

export class CliChatSession {
  readonly #runtime: AgentRuntime;
  readonly #traceStore: RuntimeTraceStore;
  readonly #sessionStore: SessionStore;
  readonly #sessionId: string;
  readonly #config: RedactedConfigView;
  readonly #approvalPromptLog: string[];
  readonly #skillDefinitions: SkillDefinition[];
  readonly #gateway: GatewayCore | undefined;

  constructor(
    runtime: AgentRuntime,
    config: RedactedConfigView = redactedConfig(loadConfig()),
    traceStore: RuntimeTraceStore = new InMemoryRuntimeTraceStore(),
    sessionId = createSessionId(),
    sessionStore: SessionStore = new InMemorySessionStore({ createSessionId: () => sessionId }),
    _recentMessageLimit = 12,
    approvalPromptLog: string[] = [],
    skillDefinitions: SkillDefinition[] = [],
    gateway?: GatewayCore
  ) {
    this.#runtime = runtime;
    this.#config = config;
    this.#traceStore = traceStore;
    this.#sessionStore = sessionStore;
    this.#sessionId = sessionId;
    this.#approvalPromptLog = approvalPromptLog;
    this.#skillDefinitions = skillDefinitions;
    this.#gateway = gateway;
  }

  get sessionId(): string { return this.#sessionId; }

  async listSessions(query?: { limit?: number }): Promise<Array<{ id: string; title?: string; updatedAt: string }>> {
    return this.#sessionStore.listSessions(query);
  }

  async loadMessages(): Promise<Array<{ role: string; content: string | null }>> {
    return this.#sessionStore.listMessages(this.#sessionId);
  }

  close(): void {
    this.#gateway?.unregister(this.#sessionId);
  }

  static async createFake(
    responseContent: string | ((message: string) => string) = "Fake response to: Hello trace",
    options: RunCliOptions = {},
    sessionOptions: CreateChatSessionOptions = {}
  ): Promise<CliChatSession> {
    const config = redactedConfig(await loadCliConfig({ ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) }));
    const approvalPromptLog: string[] = [];
    const provider =
      options.fakeModelOutputs
        ? new FakeModelProvider(options.fakeModelOutputs)
        : typeof responseContent === "function"
        ? new MessageMappedFakeModelProvider(responseContent)
        : new FakeModelProvider([
            {
              type: "message",
              content: responseContent
            }
          ]);

    return new CliChatSession(
      new AgentRuntime({
        contextAssembler: createCliContextAssembler(config),
        modelProvider: provider,
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        runtime: {
          mode: "confirm",
          workspace: config.workspace.root,
          currentDate: new Date().toISOString().slice(0, 10)
        },
        tools: createCliBuiltInTools(options, config),
        approvalResolver: createCliApprovalResolver(options, approvalPromptLog),
        maxSteps: 20,
        compaction: {}
      }),
      config,
      new InMemoryRuntimeTraceStore(),
      sessionOptions.sessionId ?? createSessionId(),
      undefined,
      12,
      approvalPromptLog
    );
  }

  static async createConfigured(config: EffectiveConfig, options: RunCliOptions = {}, sessionOptions: CreateChatSessionOptions = {}): Promise<CliChatSession> {
    const sessionId = sessionOptions.sessionId ?? createSessionId();
    const currentDate = new Date().toISOString().slice(0, 10);
    const approvalPromptLog: string[] = [];

    const skillDefinitions = await new SkillLoader().load({ workspaceRoot: config.workspace.root });
    const skillIndex = skillDefinitions.map(toSkillSummary);
    const skillFileMap = new Map(skillDefinitions.map((s) => [s.name, s.filePath]));

    const configuredProvider = createConfiguredProvider(config, options);
    const approvalResolver = sessionOptions.approvalResolver ?? createCliApprovalResolver(options, approvalPromptLog);

    const builtInTools = createCliBuiltInTools(options, config, skillFileMap);

    const factory: SubagentFactory = {
      create: (goal) => new AgentRuntime({
        contextAssembler: createCliContextAssembler(redactedConfig(config)),
        modelProvider: configuredProvider,
        systemInstruction: `You are Vole, a sub-agent handling: ${goal}`,
        runtime: { mode: config.runtime.defaultMode, workspace: config.workspace.root, currentDate },
        tools: createCliBuiltInTools(options, config),
        maxSteps: 8
      })
    };

    const taskflowPath = join(dirname(resolveSessionsDirectory(config, options.env)), "taskflow.jsonl");
    const taskFlowStore = new JsonlTaskFlowStore(taskflowPath);

    const allToolsRaw = [
      ...builtInTools,
      createSpawnSubagentTool(factory),
      createSpawnSubagentAsyncTool(factory, { taskStore: taskFlowStore }),
      createCheckSubagentTool(taskFlowStore)
    ];
    const allTools = config.runtime.toolProfile !== undefined
      ? filterToolsByProfile(allToolsRaw, config.runtime.toolProfile as ToolProfile)
      : allToolsRaw;

    const now = new Date().toISOString();
    const gatewaySession: GatewaySession = {
      id: sessionId,
      adapterName: "cli",
      capabilities: CLI_CAPABILITIES,
      registeredAt: now,
      lastActivityAt: now
    };
    cliGateway.register(gatewaySession);

    return new CliChatSession(
      new AgentRuntime({
        contextAssembler: createCliContextAssembler(config),
        modelProvider: configuredProvider,
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        runtime: {
          mode: config.runtime.defaultMode,
          workspace: config.workspace.root,
          currentDate
        },
        tools: allTools,
        skillIndex,
        preferStreaming: sessionOptions.preferStreaming ?? false,
        approvalResolver,
        maxSteps: 20,
        compaction: {},
        ...(config.runtime.promptMode !== undefined ? { promptMode: config.runtime.promptMode } : {}),
        ...(config.runtime.executionContract !== undefined ? { executionContract: config.runtime.executionContract } : {})
      }),
      redactedConfig(config),
      new InMemoryRuntimeTraceStore(),
      sessionId,
      createConfiguredSessionStore(config, options, sessionId),
      12,
      approvalPromptLog,
      skillDefinitions,
      cliGateway
    );
  }

  async sendMessage(message: string, opts: { onEvent?: (event: RuntimeEvent) => void; signal?: AbortSignal } = {}): Promise<CliChatTurnResult> {
    const events: RuntimeEvent[] = [];
    const approvalStartIndex = this.#approvalPromptLog.length;
    await this.#ensureSession();
    // Load all messages without a limit — compact_boundary handles truncation in #replay()
    const recentMessages = (await this.#sessionStore.listMessages(this.#sessionId)).map(
      (sessionMessage) => ({
        role: sessionMessage.role,
        content: sessionMessage.content,
        ...(sessionMessage.toolCalls !== undefined ? { toolCalls: sessionMessage.toolCalls } : {}),
        ...(sessionMessage.toolCallId !== undefined ? { toolCallId: sessionMessage.toolCallId } : {})
      })
    );

    // Route every chat run through the gateway when one is configured (production path).
    // The gateway threads work through the global / subagent / session lanes and handles cancel.
    // When no gateway is wired (createFake test path), fall back to direct runTurn.
    const runId = `run_${crypto.randomUUID()}`;
    const sessionId = this.#sessionId;
    const runtime = this.#runtime;
    const gateway = this.#gateway;
    if (gateway !== undefined && opts.signal !== undefined) {
      opts.signal.addEventListener("abort", () => { gateway.cancel(runId); }, { once: true });
    }
    const eventStream: AsyncIterable<RuntimeEvent> = gateway !== undefined
      ? gateway.submit<RuntimeEvent>({
          runId,
          sessionKey: sessionId,
          agentId: "default",
          run: async function* (signal: AbortSignal) {
            for await (const event of runtime.runTurn({ sessionId, recentMessages, message, signal })) {
              yield event;
            }
          }
        })
      : runtime.runTurn({ sessionId, recentMessages, message, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });

    for await (const event of eventStream) {
      await this.#traceStore.append(event);
      await this.#sessionStore.appendTraceEvent({ sessionId: this.#sessionId, event });
      events.push(event);
      opts.onEvent?.(event);

      // Persist compaction boundary when compaction fires with a non-empty summary
      if (event.type === "compaction_triggered" && event.summary) {
        await this.#sessionStore.appendCompactBoundary({
          sessionId: this.#sessionId,
          summary: event.summary,
          messagesBefore: event.messagesBefore,
          messagesAfter: event.messagesAfter
        });
      }

      // Persist all turn messages (user + tool_use + tool_results + final assistant)
      if (event.type === "turn_complete") {
        for (const msg of event.messages) {
          await this.#sessionStore.appendMessage({
            sessionId: this.#sessionId,
            role: msg.role,
            content: msg.content ?? null,
            ...(msg.toolCalls !== undefined ? { toolCalls: msg.toolCalls } : {}),
            ...(msg.toolCallId !== undefined ? { toolCallId: msg.toolCallId } : {})
          });
        }
      }
    }

    const assistantMessage = events.find((event) => event.type === "assistant_message_created");
    const assistantText =
      assistantMessage?.type === "assistant_message_created"
        ? assistantMessage.message.content
        : "No assistant message was produced.";

    return {
      assistantText,
      approvalLines: this.#approvalPromptLog.slice(approvalStartIndex),
      todosLines: renderTodosProgress(events),
      events
    };
  }

  async runSlashCommand(command: string): Promise<string[]> {
    if (command === "/trace") {
      const traceEvents = await this.#sessionStore.listTraceEvents<RuntimeEvent>(this.#sessionId);

      return renderCompactTrace(traceEvents.map((traceEvent) => traceEvent.event));
    }

    if (command === "/config") {
      return renderRedactedConfig(this.#config);
    }

    if (command === "/skills") {
      return renderSkillIndex(this.#skillDefinitions);
    }

    if (command === "/help") {
      return renderInteractiveHelp();
    }

    return [`Unknown slash command: ${command}`];
  }

  async #ensureSession(): Promise<void> {
    if ((await this.#sessionStore.getSession(this.#sessionId)) !== undefined) {
      return;
    }

    await this.#sessionStore.createSession({ title: this.#sessionId });
  }
}

function createCliApprovalResolver(options: RunCliOptions, approvalPromptLog: string[]): ApprovalResolver {
  return {
    async resolve(request) {
      approvalPromptLog.push(
        "Approval required:",
        `Tool: ${request.call.name}`,
        `Risk: ${request.decision.risk}`,
        `Reason: ${request.decision.reason}`
      );

      const answer = (await options.readLine?.("Approve once? [y/N/details] "))?.trim().toLowerCase();
      if (answer === "y" || answer === "yes") {
        approvalPromptLog.push("Decision: approved once.");
        return {
          approved: true,
          reason: "Approved once from CLI prompt."
        };
      }

      approvalPromptLog.push("Decision: denied");
      return {
        approved: false,
        reason: "Denied from CLI prompt."
      };
    }
  };
}

function createCliBuiltInTools(options: RunCliOptions, config?: EffectiveConfig, skillFileMap?: SkillFileMap) {
  const tools = [
    createReadFileTool(),
    createListDirectoryTool(),
    createWriteFileTool(),
    createEditFileTool(),
    createAppendFileTool(),
    createShellTool(config?.runtime.sandboxed !== undefined ? { sandboxed: config.runtime.sandboxed } : undefined),
    createReadWebPageTool(options.fetch),
    createSearchFilesTool()
  ];

  if (config?.memory.longTermFiles === "write") {
    tools.push(createAppendDailyMemoryTool());
  }

  if (config?.memory.longTermFiles === "read-only" || config?.memory.longTermFiles === "write") {
    const workspaceRoot = config.workspace.root;
    tools.push(createMemorySearchTool(workspaceRoot));
    tools.push(createMemoryGetTool(workspaceRoot));
  }

  tools.push(createUpdateHeartbeatTool());

  if (skillFileMap !== undefined && skillFileMap.size > 0) {
    tools.push(createLoadSkillTool(skillFileMap));
  }

  return tools;
}

class MessageMappedFakeModelProvider implements ModelProvider {
  readonly requests: ModelInput[] = [];

  readonly #mapMessage: (message: string) => string;

  constructor(mapMessage: (message: string) => string) {
    this.#mapMessage = mapMessage;
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    this.requests.push(input);
    const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";

    return {
      type: "message",
      content: this.#mapMessage(lastUserMessage)
    };
  }
}

function createConfiguredProvider(config: EffectiveConfig, options: RunCliOptions): ModelProvider {
  if (config.model.provider === "anthropic") {
    return new AnthropicProvider({
      ...(config.secrets.apiKey !== undefined ? { apiKey: config.secrets.apiKey } : {}),
      model: config.model.model,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      ...(config.model.thinkingBudget !== undefined ? { thinkingBudget: config.model.thinkingBudget } : {})
    });
  }
  return new OpenAICompatibleProvider({
    baseURL: config.model.baseURL,
    ...(config.secrets.apiKey !== undefined ? { apiKey: config.secrets.apiKey } : {}),
    model: config.model.model,
    temperature: config.model.temperature,
    maxTokens: config.model.maxTokens,
    ...(options.fetch ? { fetch: options.fetch } : {})
  });
}

function createConfiguredSessionStore(config: EffectiveConfig, options: RunCliOptions, sessionId: string): SessionStore {
  // options.sessionsDirectory can override the directory for tests (avoids touching user files)
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const directory = resolveSessionsDirectory(effectiveConfig, options.env);

  // The configured CLI path uses JSONL so named sessions can be replayed across
  // process runs; tests can still inject a temp directory to avoid user files.
  return new JsonlSessionStore({
    directory,
    createSessionId: () => sessionId
  });
}

function createCliContextAssembler(_config: RedactedConfigView | EffectiveConfig): DefaultContextAssembler {
  // Bootstrap files align with OpenClaw's documented workspace bootstrap list.
  // Files that don't exist are silently skipped by DefaultContextAssembler.
  // Daily memory files (memory/YYYY-MM-DD.md) are intentionally excluded: OpenClaw
  // docs state they are accessed through memory tools, not injected at bootstrap.
  return new DefaultContextAssembler({
    workspacePromptFiles: [
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "IDENTITY.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
      "USER.md",
      "MEMORY.md"
    ]
  });
}

function createSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

export function renderTodosProgress(events: RuntimeEvent[]): string[] {
  const todosEvent = [...events].reverse().find((e) => e.type === "todos_updated");
  if (todosEvent?.type !== "todos_updated" || todosEvent.todos.length === 0) return [];

  const lines = ["Todo:"];
  for (const todo of todosEvent.todos) {
    const icon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "→" : "·";
    lines.push(`  ${icon} ${todo.content}`);
  }
  return lines;
}

export function renderSkillIndex(skills: SkillDefinition[]): string[] {
  if (skills.length === 0) return ["No skills loaded."];

  const lines: string[] = [];
  const untrustedNames: string[] = [];

  for (const s of skills) {
    const trustBadge = s.source === "user" && s.trusted === false ? " ⚠ untrusted" : "";
    const versionBadge = s.version !== undefined ? ` v${s.version}` : "";
    const permsBadge = s.permissions !== undefined && s.permissions.length > 0
      ? ` [${s.permissions.join(", ")}]`
      : "";
    lines.push(`[${s.source}]${trustBadge}${versionBadge} ${s.name}: ${s.description}${permsBadge}`);

    if (s.source === "user" && s.trusted === false) {
      untrustedNames.push(s.name);
    }
  }

  if (untrustedNames.length > 0) {
    lines.push("");
    for (const name of untrustedNames) {
      lines.push(`This skill was installed from an external source and has not been trusted. Run \`vole skills trust ${name}\` to trust it.`);
    }
  }

  return lines;
}

export function renderRedactedConfig(config: RedactedConfigView): string[] {
  return [
    `Provider: ${config.model.provider}`,
    `Model: ${config.model.model}`,
    `Base URL: ${config.model.baseURL}`,
    `Default mode: ${config.runtime.defaultMode}`,
    `Trace verbosity: ${config.trace.verbosity}`,
    `Long-term memory files: ${config.memory.longTermFiles}`,
    `Memory writes: ${config.memory.writes}`,
    `API key: ${config.secrets.apiKey}`
  ];
}

export function renderToolResult(result: import("@vole/tools").ToolExecutionResult): string {
  if ("entries" in result && Array.isArray(result.entries)) {
    return result.entries.map((e: { name: string; type: string }) => `  ${e.type === "directory" ? "📁" : "📄"} ${e.name}`).join("\n");
  }
  if ("content" in result && typeof result.content === "string") {
    const lines = result.content.split("\n");
    return lines.length > 30 ? lines.slice(0, 30).join("\n") + `\n  … (${lines.length - 30} more lines)` : result.content;
  }
  if ("stdout" in result) {
    const out = [(result as { stdout?: string }).stdout, (result as { stderr?: string }).stderr].filter(Boolean).join("\n");
    return out || "(no output)";
  }
  if ("error" in result) {
    const err = (result as { error: unknown }).error;
    return `Error: ${typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : String(err)}`;
  }
  return JSON.stringify(result, null, 2);
}

export function renderCompactTrace(events: RuntimeEvent[]): string[] {
  return events.map((event, index) => `${index + 1}. ${traceEventLabel(event)} (${event.type})`);
}

function traceEventLabel(event: RuntimeEvent): string {
  switch (event.type) {
    case "run_started":
      return "Received user message";
    case "context_assembled":
      return "Assembled context";
    case "compaction_triggered":
      return `Compacted context (${event.messagesBefore} → ${event.messagesAfter} messages)`;
    case "todos_updated":
      return `Updated todos (${event.todos.length} items)`;
    case "planning_stall_detected":
      return `Planning stall detected (${event.stallCount}/${event.maxRetries})`;
    case "model_request_started":
      return "Started model request";
    case "token_delta":
      return `Token delta: "${event.delta.slice(0, 20)}${event.delta.length > 20 ? "…" : ""}"`;
    case "model_request_completed":
      return "Completed model request";
    case "tool_call_requested":
      return "Requested tool call";
    case "tool_call_permission_evaluated":
      return "Evaluated tool permission";
    case "approval_requested":
      return "Requested approval";
    case "approval_resolved":
      return "Resolved approval";
    case "tool_started":
      return `Tool: ${event.toolName}`;
    case "tool_completed":
      return `Result [${event.toolName}]:\n${renderToolResult(event.result)}`;
    case "tool_failed":
      return `Tool failed [${event.toolName}]: ${event.error.message}`;
    case "assistant_message_created":
      return "Created assistant message";
    case "turn_complete":
      return `Turn complete (${event.messages.length} messages)`;
    case "run_completed":
      return "Completed run";
    case "run_failed":
      return "Failed run";
  }
}

async function runWebDashboard(port: number, openBrowser: boolean): Promise<CliResult> {
  const selfDir = dirname(fileURLToPath(import.meta.url));

  // Production (npm install): web files are bundled alongside dist/index.js.
  // Development (tsx src/):   web files live in apps/web/dist/.
  const candidates: Array<{ server: string; cwd: string }> = [
    { server: join(selfDir, "web", "server.js"),           cwd: join(selfDir, "web") },
    { server: join(selfDir, "../../web", "dist", "server.js"), cwd: join(selfDir, "../../web") },
  ];

  let resolved: { server: string; cwd: string } | undefined;
  for (const c of candidates) {
    try { await stat(c.server); resolved = c; break; } catch { /* try next */ }
  }

  if (resolved === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Web app not built. Run first:\n  pnpm --filter @vole/web build\n`
    };
  }

  const url = `http://localhost:${port}`;
  const child = spawn("node", [resolved.server], {
    // Pass the user's actual working directory so the web server can detect
    // the git root and store sessions in the right project directory.
    env: { ...process.env, PORT: String(port), VOLE_WEB_ROOT: process.cwd() },
    stdio: "inherit",
    cwd: resolved.cwd
  });

  process.stdout.write(`Vole web dashboard → ${url}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");

  if (openBrowser) {
    const opener =
      process.platform === "darwin" ? "open" :
      process.platform === "win32"  ? "cmd" :
      "xdg-open";
    const openerArgs = process.platform === "win32" ? ["/c", "start", url] : [url];
    setTimeout(() => {
      spawn(opener, openerArgs, { stdio: "ignore", detached: true }).unref();
    }, 800);
  }

  return new Promise<CliResult>((resolve) => {
    const shutdown = () => {
      child.kill();
      resolve({ exitCode: 0, stdout: "Web server stopped.\n", stderr: "" });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    child.once("exit", (code) => resolve({ exitCode: code ?? 0, stdout: "", stderr: "" }));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command] = args;

  // Real interactive chat → use Ink for streaming rendering
  // args[0] may be "--" when invoked as `pnpm cli -- chat`; skip it.
  // No subcommand (bare `vole`) also defaults to chat.
  const effectiveCommand = args.find((a) => a !== "--");
  // Route to Ink chat when: explicit "chat" subcommand, OR no subcommand with a real TTY
  // (bare `vole` defaults to chat in interactive terminals; non-TTY contexts get commander/help).
  const useInkChat = effectiveCommand === "chat" || (effectiveCommand === undefined && process.stdin.isTTY === true);
  if (useInkChat && !args.includes("--help") && !args.includes("-h") && !args.includes("--fake") && !args.includes("--fake-interactive")) {
    const { runInkChat } = await import("./app.js");
    await runInkChat({ args, env: process.env });
    return;
  }

  // All other commands → existing readline-based path
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const lineIterator = terminal[Symbol.asyncIterator]();

  const selfDir = dirname(fileURLToPath(import.meta.url));
  let pkgVersion = "0.0.0";
  try {
    const raw = await readFile(join(selfDir, "../package.json"), "utf8");
    pkgVersion = (JSON.parse(raw) as { version: string }).version;
  } catch { /* ignore */ }

  const result = await runCli(args, pkgVersion, {
    env: process.env,
    readLine: async (prompt) => {
      process.stdout.write(prompt);
      const line = await lineIterator.next();

      return line.done ? undefined : line.value;
    },
    write: (text) => process.stdout.write(text)
  });

  terminal.close();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

void main();

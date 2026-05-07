/**
 * INPUT: CLI args, config (including thinkingBudget), model providers, skill loader, session/trace stores, taskflow store, built-in tools, optional fake outputs and line reader.
 * OUTPUT: Chat, approvals, tool execution, todos, skill management subcommands, session/task/taskflow listings, daemon cron scheduling, trace, redacted config, stdout/stderr, gateway session registration, run --dream memory dreaming.
 * POS: CLI adapter layer; translates terminal commands and approval prompts without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, resolveSessionsDirectory, type EffectiveConfig, type RedactedConfigView } from "@peewit/config";
import { DefaultContextAssembler } from "@peewit/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, createSpawnSubagentTool, type ApprovalRequest, type ApprovalResolution, type ApprovalResolver, type RuntimeEvent, type RuntimeTraceStore, type SubagentFactory } from "@peewit/core";
import { SessionGateway, type GatewaySession } from "@peewit/gateway";
import { AnthropicProvider, FakeModelProvider, OpenAICompatibleProvider, type ModelInput, type ModelOutput, type ModelProvider } from "@peewit/models";
import { CLI_CAPABILITIES, filterToolsByProfile, type ToolProfile } from "@peewit/adapters";
import { BackgroundApprovalResolver, CronScheduler, JsonlTaskStore, type TaskDefinition, type TaskRunRecord } from "@peewit/scheduler";
import { InMemorySessionStore, JsonlSessionStore, type SessionStore } from "@peewit/sessions";
import { JsonlTaskFlowStore } from "@peewit/taskflow";
import { SkillLoader, SkillManager, toSkillSummary, type SkillDefinition } from "@peewit/skills";
import { createAppendDailyMemoryTool, createAppendFileTool, createEditFileTool, createListDirectoryTool, createLoadSkillTool, createMemoryGetTool, createMemorySearchTool, createReadFileTool, createReadWebPageTool, createSearchFilesTool, createShellTool, createWriteFileTool, type SkillFileMap } from "@peewit/tools";

export const cliPackageName = "@peewit/cli";

// Core system instruction — adapted from OpenClaw's execution bias section.
// Loaded as the <identity> XML section; workspace files (SOUL.md, AGENTS.md)
// are loaded into the <workspace> section on top of this.
const AGENT_SYSTEM_INSTRUCTION = `\
You are Peewit, a capable coding and general-purpose agent.

## Tool Call Style
Do not narrate routine, low-risk tool calls — just call the tool.
Narrate only when it genuinely helps: multi-step work, sensitive actions, or when explaining a non-obvious choice.
Keep narration brief; avoid restating what tool output already shows.

## Execution Bias
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

/** Module-level SessionGateway singleton — tracks all active CLI sessions in this process. */
const cliGateway = new SessionGateway();

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  fakeModelOutputs?: ModelOutput[];
  fetch?: FetchLike;
  readLine?: (prompt: string) => Promise<string | undefined>;
  sessionsDirectory?: string;
  write?: (text: string) => void;
}

const helpText = `Usage: peewit <command>

Commands:
  chat        Start an interactive chat session
  chat --session <id>
              Start or continue a named interactive chat session
  chat --resume
              Continue the most recently updated stored chat session
  chat --fake <message>
              Run one message-only turn with a fake provider
  chat --fake-interactive
              Start an interactive chat session with a fake provider
  sessions    List stored chat sessions
  run "<goal>"
              Run a one-shot background task
  run "<goal>" --mode auto|confirm
              Run with explicit autonomy mode (default: confirm)
  run --dream
              Run memory dreaming — consolidate daily notes into MEMORY.md
  tasks       List recent background task runs
  tasks --limit N
              Show last N runs
  skills      List all skills with source, version, trust status
  skills install <path>
              Install a skill from a local .md file
  skills enable <name>
              Enable a disabled skill
  skills disable <name>
              Disable an enabled skill
  skills trust <name>
              Mark an installed skill as trusted
  skills review <name>
              Show full skill metadata and permission declarations
  daemon      Start the task scheduler daemon (runs scheduled tasks)
  daemon --once
              Run all due tasks once and exit
  taskflow list
              List recent task records
  taskflow list --limit N
              Show last N records
  taskflow show <id>
              Show details of a task
  taskflow cancel <id>
              Mark a task as cancelled
  --help      Show this help message
  --version   Show the CLI version
`;

export async function runCli(args: string[], packageVersion: string, options: RunCliOptions = {}): Promise<CliResult> {
  const [command, ...rest] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      stdout: helpText,
      stderr: ""
    };
  }

  if (command === "--version" || command === "-v") {
    return {
      exitCode: 0,
      stdout: `${packageVersion}\n`,
      stderr: ""
    };
  }

  if (command === "chat") {
    const parsedChatArgs = parseChatArgs(rest);

    if (rest[0] === "--fake") {
      return runFakeChatTurn(parseFakeChatArgs(rest.slice(1)), options);
    }

    if (parsedChatArgs.fakeInteractive) {
      return runInteractiveFakeChat(options, parsedChatArgs);
    }

    return runInteractiveConfiguredChat(options, parsedChatArgs);
  }

  if (command === "sessions") {
    return runListSessions(options);
  }

  if (command === "run") {
    if (rest.includes("--dream")) {
      return runMemoryDreaming(options);
    }

    const modeIndex = rest.indexOf("--mode");
    const rawMode = modeIndex !== -1 ? rest[modeIndex + 1] : undefined;
    const mode = rawMode === "auto" ? "auto" : rawMode === "observe" ? "observe" : "confirm";
    const goal = rest.filter((arg) => !arg.startsWith("--") && arg !== rawMode).join(" ").trim();

    if (goal === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: `Missing goal for \`run\`. Usage: peewit run "<goal>"\n`
      };
    }

    return runBackgroundTask(goal, mode, options);
  }

  if (command === "tasks") {
    const limitIndex = rest.indexOf("--limit");
    const limitStr = limitIndex !== -1 ? rest[limitIndex + 1] : undefined;
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;

    return runListTasks(options, limit);
  }

  if (command === "skills") {
    return runSkillsCommand(rest, options);
  }

  if (command === "daemon") {
    const once = rest.includes("--once");
    return runDaemon(options, once);
  }

  if (command === "taskflow") {
    return runTaskflowCommand(rest, options);
  }

  return {
    exitCode: 1,
    stdout: helpText,
    stderr: `Unknown command "${command}".\n`
  };
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

function parseChatArgs(args: string[]): ParsedChatArgs {
  const sessionIndex = args.indexOf("--session");

  return {
    fakeInteractive: args.includes("--fake-interactive"),
    resume: args.includes("--resume"),
    ...(sessionIndex === -1 || args[sessionIndex + 1] === undefined ? {} : { sessionId: args[sessionIndex + 1] })
  };
}

function parseFakeChatArgs(args: string[]): ParsedFakeChatArgs {
  const slashIndex = args.findIndex((arg) => arg.startsWith("/"));
  const messageArgs = slashIndex === -1 ? args : args.slice(0, slashIndex);
  const slashCommands = slashIndex === -1 ? [] : args.slice(slashIndex);

  return {
    message: messageArgs.join(" "),
    slashCommands
  };
}

async function runFakeChatTurn(input: ParsedFakeChatArgs, options: RunCliOptions): Promise<CliResult> {
  const { message, slashCommands } = input;

  if (message.trim() === "") {
    return {
      exitCode: 1,
      stdout: helpText,
      stderr: "Missing message for `chat --fake`.\n"
    };
  }

  const session = CliChatSession.createFake(`Fake response to: ${message}`, options);
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
  const session = CliChatSession.createFake((message) => `Fake response to: ${message}`, options, {
    ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId })
  });

  return runInteractiveLoop(session, "Peewit chat (fake provider)", options);
}

async function runInteractiveConfiguredChat(options: RunCliOptions, args: ParsedChatArgs): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing PEEWIT_API_KEY or OPENROUTER_API_KEY. Set one to start `peewit chat`, or use `peewit chat --fake-interactive` for local learning.\n"
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
      stderr: "No stored sessions to resume. Start one with `peewit chat` or `peewit chat --session <id>`.\n"
    };
  }

  const sessionId = args.sessionId ?? resumedSessionId;

  return runInteractiveLoop(
    await CliChatSession.createConfigured(config, options, {
      ...(sessionId === undefined ? {} : { sessionId })
    }),
    resumedSessionId === undefined ? "Peewit chat" : `Peewit chat\nResumed session: ${resumedSessionId}`,
    options
  );
}

async function runListSessions(options: RunCliOptions): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});
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

async function runMemoryDreaming(options: RunCliOptions): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing PEEWIT_API_KEY or OPENROUTER_API_KEY. Set one to run memory dreaming.\n"
    };
  }

  if (config.memory.longTermFiles !== "write") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Memory dreaming requires PEEWIT_LONG_TERM_MEMORY=write\n"
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
  const config = loadConfig(options.env ? { env: options.env } : {});

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing PEEWIT_API_KEY or OPENROUTER_API_KEY. Set one to run background tasks.\n"
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
    contextAssembler: createCliContextAssembler(config, currentDate),
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
  const config = loadConfig(options.env ? { env: options.env } : {});
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
    contextAssembler: createCliContextAssembler(config, currentDate),
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

  const updates: Partial<TaskRunRecord> = {
    status,
    assistantText,
    completedAt: new Date().toISOString(),
    ...(failedEvent?.type === "run_failed" ? { errorMessage: failedEvent.error.message } : {})
  };
  await taskStore.updateRun(runId, updates);
}

async function runDaemon(options: RunCliOptions, once: boolean): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing PEEWIT_API_KEY or OPENROUTER_API_KEY. Set one to run the daemon.\n"
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

function resolveTaskflowFilePath(options: RunCliOptions): string {
  const config = loadConfig(options.env ? { env: options.env } : {});
  const effectiveConfig = options.sessionsDirectory
    ? { ...config, sessions: { directory: options.sessionsDirectory } }
    : config;
  const sessionsDir = resolveSessionsDirectory(effectiveConfig, options.env);
  return join(dirname(sessionsDir), "taskflow.jsonl");
}

async function runTaskflowCommand(args: string[], options: RunCliOptions): Promise<CliResult> {
  const subcommand = args[0];

  if (subcommand === undefined || subcommand === "list") {
    const limitIndex = args.indexOf("--limit");
    const limitStr = limitIndex !== -1 ? args[limitIndex + 1] : undefined;
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
    return runTaskflowList(options, limit);
  }

  if (subcommand === "show") {
    const id = args[1];
    if (id === undefined || id === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: "Missing id for `taskflow show`. Usage: peewit taskflow show <id>\n"
      };
    }
    return runTaskflowShow(id, options);
  }

  if (subcommand === "cancel") {
    const id = args[1];
    if (id === undefined || id === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: "Missing id for `taskflow cancel`. Usage: peewit taskflow cancel <id>\n"
      };
    }
    return runTaskflowCancel(id, options);
  }

  return {
    exitCode: 1,
    stdout: helpText,
    stderr: `Unknown taskflow subcommand "${subcommand}".\n`
  };
}

async function runTaskflowList(options: RunCliOptions, limit?: number): Promise<CliResult> {
  const filePath = resolveTaskflowFilePath(options);
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
  const filePath = resolveTaskflowFilePath(options);
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
  const filePath = resolveTaskflowFilePath(options);
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

async function runSkillsCommand(args: string[], options: RunCliOptions): Promise<CliResult> {
  const subcommand = args[0];

  if (subcommand === undefined || subcommand === "") {
    // List all skills
    return runSkillsList(options);
  }

  if (subcommand === "install") {
    const sourcePath = args[1];
    if (sourcePath === undefined || sourcePath === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: "Missing path for `skills install`. Usage: peewit skills install <path>\n"
      };
    }
    return runSkillsInstall(sourcePath, options);
  }

  if (subcommand === "enable" || subcommand === "disable" || subcommand === "trust") {
    const name = args[1];
    if (name === undefined || name === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: `Missing name for \`skills ${subcommand}\`. Usage: peewit skills ${subcommand} <name>\n`
      };
    }
    return runSkillsLifecycle(subcommand, name, options);
  }

  if (subcommand === "review") {
    const name = args[1];
    if (name === undefined || name === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: "Missing name for `skills review`. Usage: peewit skills review <name>\n"
      };
    }
    return runSkillsReview(name, options);
  }

  return {
    exitCode: 1,
    stdout: helpText,
    stderr: `Unknown skills subcommand "${subcommand}".\n`
  };
}

async function runSkillsList(options: RunCliOptions): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});
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
  const config = loadConfig(options.env ? { env: options.env } : {});
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
  const config = loadConfig(options.env ? { env: options.env } : {});
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
  const config = loadConfig(options.env ? { env: options.env } : {});
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
  readonly #recentMessageLimit: number;
  readonly #approvalPromptLog: string[];
  readonly #skillDefinitions: SkillDefinition[];
  readonly #gateway: SessionGateway | undefined;

  constructor(
    runtime: AgentRuntime,
    config: RedactedConfigView = redactedConfig(loadConfig()),
    traceStore: RuntimeTraceStore = new InMemoryRuntimeTraceStore(),
    sessionId = createSessionId(),
    sessionStore: SessionStore = new InMemorySessionStore({ createSessionId: () => sessionId }),
    recentMessageLimit = 12,
    approvalPromptLog: string[] = [],
    skillDefinitions: SkillDefinition[] = [],
    gateway?: SessionGateway
  ) {
    this.#runtime = runtime;
    this.#config = config;
    this.#traceStore = traceStore;
    this.#sessionStore = sessionStore;
    this.#sessionId = sessionId;
    this.#recentMessageLimit = recentMessageLimit;
    this.#approvalPromptLog = approvalPromptLog;
    this.#skillDefinitions = skillDefinitions;
    this.#gateway = gateway;
  }

  close(): void {
    this.#gateway?.unregister(this.#sessionId);
  }

  static createFake(
    responseContent: string | ((message: string) => string) = "Fake response to: Hello trace",
    options: RunCliOptions = {},
    sessionOptions: CreateChatSessionOptions = {}
  ): CliChatSession {
    const config = redactedConfig(loadConfig(options.env ? { env: options.env } : {}));
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
        contextAssembler: createCliContextAssembler(config, new Date().toISOString().slice(0, 10)),
        modelProvider: provider,
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        runtime: {
          mode: "confirm",
          workspace: config.workspace.root,
          currentDate: new Date().toISOString().slice(0, 10)
        },
        tools: createCliBuiltInTools(options, config),
        approvalResolver: createCliApprovalResolver(options, approvalPromptLog),
        maxSteps: 20
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
    if (config.secrets.apiKey === undefined) {
      throw new Error("Configured chat requires an API key.");
    }

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
        contextAssembler: createCliContextAssembler(redactedConfig(config), currentDate),
        modelProvider: configuredProvider,
        systemInstruction: `You are Peewit, a sub-agent handling: ${goal}`,
        runtime: { mode: config.runtime.defaultMode, workspace: config.workspace.root, currentDate },
        tools: createCliBuiltInTools(options, config),
        maxSteps: 8
      })
    };

    const allToolsRaw = [...builtInTools, createSpawnSubagentTool(factory)];
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
        contextAssembler: createCliContextAssembler(config, currentDate),
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

  async sendMessage(message: string, opts: { onEvent?: (event: RuntimeEvent) => void } = {}): Promise<CliChatTurnResult> {
    const events: RuntimeEvent[] = [];
    const approvalStartIndex = this.#approvalPromptLog.length;
    await this.#ensureSession();
    const recentMessages = (await this.#sessionStore.listMessages(this.#sessionId, { limit: this.#recentMessageLimit })).map(
      (sessionMessage) => ({
        role: sessionMessage.role,
        content: sessionMessage.content
      })
    );

    for await (const event of this.#runtime.runTurn({ sessionId: this.#sessionId, recentMessages, message })) {
      await this.#traceStore.append(event);
      await this.#sessionStore.appendTraceEvent({ sessionId: this.#sessionId, event });
      events.push(event);
      opts.onEvent?.(event);
    }

    const assistantMessage = events.find((event) => event.type === "assistant_message_created");
    const assistantText =
      assistantMessage?.type === "assistant_message_created"
        ? assistantMessage.message.content
        : "No assistant message was produced.";

    await this.#sessionStore.appendMessage({
      sessionId: this.#sessionId,
      role: "user",
      content: message
    });

    if (assistantMessage?.type === "assistant_message_created") {
      await this.#sessionStore.appendMessage({
        sessionId: this.#sessionId,
        role: "assistant",
        content: assistantText
      });
    }

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

function createCliContextAssembler(config: RedactedConfigView | EffectiveConfig, currentDate: string): DefaultContextAssembler {
  const workspacePromptFiles = [
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "IDENTITY.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md"
  ];

  if (config.memory.longTermFiles === "read-only") {
    workspacePromptFiles.push("USER.md", "MEMORY.md", `memory/${currentDate}.md`, `memory/${previousIsoDate(currentDate)}.md`);
  }

  return new DefaultContextAssembler({
    workspacePromptFiles
  });
}

function previousIsoDate(currentDate: string): string {
  const date = new Date(`${currentDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

function createSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

export function renderTodosProgress(events: RuntimeEvent[]): string[] {
  const todosEvent = [...events].reverse().find((e) => e.type === "todos_updated");
  if (todosEvent?.type !== "todos_updated" || todosEvent.todos.length === 0) return [];

  const lines = ["Tasks:"];
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
      lines.push(`This skill was installed from an external source and has not been trusted. Run \`peewit skills trust ${name}\` to trust it.`);
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

export function renderToolResult(result: import("@peewit/tools").ToolExecutionResult): string {
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
    case "run_completed":
      return "Completed run";
    case "run_failed":
      return "Failed run";
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command] = args;

  // Real interactive chat → use Ink for streaming rendering
  if (command === "chat" && !args.includes("--fake") && !args.includes("--fake-interactive")) {
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

  const result = await runCli(args, "0.0.0", {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

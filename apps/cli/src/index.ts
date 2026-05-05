/**
 * INPUT: CLI args, config, model providers, skill loader, session/trace stores, built-in tools, optional fake outputs and line reader.
 * OUTPUT: Chat, approvals, tool execution, todos, skill management subcommands, session/task listings, trace, redacted config, stdout/stderr, gateway session registration.
 * POS: CLI adapter layer; translates terminal commands and approval prompts without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, resolveSessionsDirectory, type EffectiveConfig, type RedactedConfigView } from "@arvinclaw/config";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, createSpawnSubagentTool, type ApprovalRequest, type ApprovalResolution, type ApprovalResolver, type RuntimeEvent, type RuntimeTraceStore, type SubagentFactory } from "@arvinclaw/core";
import { SessionGateway, type GatewaySession } from "@arvinclaw/gateway";
import { AnthropicProvider, FakeModelProvider, OpenAICompatibleProvider, type ModelInput, type ModelOutput, type ModelProvider } from "@arvinclaw/models";
import { CLI_CAPABILITIES } from "@arvinclaw/adapters";
import { BackgroundApprovalResolver, JsonlTaskStore, type TaskRunRecord } from "@arvinclaw/scheduler";
import { InMemorySessionStore, JsonlSessionStore, type SessionStore } from "@arvinclaw/sessions";
import { SkillLoader, SkillManager, toSkillSummary, type SkillDefinition } from "@arvinclaw/skills";
import { createAppendDailyMemoryTool, createListDirectoryTool, createLoadSkillTool, createMemoryGetTool, createMemorySearchTool, createReadFileTool, createReadWebPageTool, createShellTool, createWriteFileTool, type SkillFileMap } from "@arvinclaw/tools";

export const cliPackageName = "@arvinclaw/cli";

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

const helpText = `Usage: arvinclaw <command>

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
    const modeIndex = rest.indexOf("--mode");
    const rawMode = modeIndex !== -1 ? rest[modeIndex + 1] : undefined;
    const mode = rawMode === "auto" ? "auto" : rawMode === "observe" ? "observe" : "confirm";
    const goal = rest.filter((arg) => !arg.startsWith("--") && arg !== rawMode).join(" ").trim();

    if (goal === "") {
      return {
        exitCode: 1,
        stdout: helpText,
        stderr: `Missing goal for \`run\`. Usage: arvinclaw run "<goal>"\n`
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

  return runInteractiveLoop(session, "ArvinClaw chat (fake provider)", options);
}

async function runInteractiveConfiguredChat(options: RunCliOptions, args: ParsedChatArgs): Promise<CliResult> {
  const config = loadConfig(options.env ? { env: options.env } : {});

  if (config.secrets.apiKey === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Missing ARVINCLAW_API_KEY or OPENROUTER_API_KEY. Set one to start `arvinclaw chat`, or use `arvinclaw chat --fake-interactive` for local learning.\n"
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
      stderr: "No stored sessions to resume. Start one with `arvinclaw chat` or `arvinclaw chat --session <id>`.\n"
    };
  }

  const sessionId = args.sessionId ?? resumedSessionId;

  return runInteractiveLoop(
    await CliChatSession.createConfigured(config, options, {
      ...(sessionId === undefined ? {} : { sessionId })
    }),
    resumedSessionId === undefined ? "ArvinClaw chat" : `ArvinClaw chat\nResumed session: ${resumedSessionId}`,
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
      stderr: "Missing ARVINCLAW_API_KEY or OPENROUTER_API_KEY. Set one to run background tasks.\n"
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

  const runtime = new AgentRuntime({
    contextAssembler: createCliContextAssembler(config, currentDate),
    modelProvider: configuredProvider,
    systemInstruction: "You are ArvinClaw, a personal general-purpose agent running a background task. You can use tools to read files, list directories, write files, run shell commands, and read web pages. You follow a permission policy that governs which actions require approval.",
    runtime: {
      mode,
      workspace: config.workspace.root,
      currentDate
    },
    tools: createCliBuiltInTools(options, config),
    preferStreaming: false,
    approvalResolver,
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
        stderr: "Missing path for `skills install`. Usage: arvinclaw skills install <path>\n"
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
        stderr: `Missing name for \`skills ${subcommand}\`. Usage: arvinclaw skills ${subcommand} <name>\n`
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
        stderr: "Missing name for `skills review`. Usage: arvinclaw skills review <name>\n"
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

    if (message.startsWith("/")) {
      emit(...renderInteractiveSlashCommand(await session.runSlashCommand(message)), "");
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

async function renderSlashCommands(session: CliChatSession, slashCommands: string[]): Promise<string> {
  const rendered: string[] = [];

  for (const command of slashCommands) {
    if (command === "/trace") {
      rendered.push(["", "Recent Trace:", ...(await session.runSlashCommand(command))].join("\n"));
    } else if (command === "/config") {
      rendered.push(["", "Config:", ...(await session.runSlashCommand(command))].join("\n"));
    } else if (command === "/skills") {
      rendered.push(["", "Skills:", ...(await session.runSlashCommand(command))].join("\n"));
    } else {
      rendered.push(["", `Unknown slash command: ${command}`].join("\n"));
    }
  }

  return rendered.length === 0 ? "" : `${rendered.join("\n")}\n`;
}

function renderInteractiveSlashCommand(lines: string[]): string[] {
  const [firstLine] = lines;

  if (firstLine?.startsWith("Unknown slash command")) {
    return lines;
  }

  if (lines.some((line) => line.startsWith("Provider:"))) {
    return ["Config:", ...lines];
  }

  return ["Recent Trace:", ...lines];
}

function renderInteractiveHelp(): string[] {
  return [
    "Commands:",
    "/help    Show commands",
    "/trace   Show recent trace events",
    "/config  Show redacted configuration",
    "/skills  List loaded skills",
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
        systemInstruction: "You are ArvinClaw, a personal general-purpose agent. You can use tools to read files, list directories, write files, run shell commands, and read web pages. You follow a permission policy that governs which actions require user approval.",
        runtime: {
          mode: "confirm",
          workspace: config.workspace.root,
          currentDate: new Date().toISOString().slice(0, 10)
        },
        tools: createCliBuiltInTools(options, config),
        approvalResolver: createCliApprovalResolver(options, approvalPromptLog)
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
        systemInstruction: `You are ArvinClaw, a sub-agent handling: ${goal}`,
        runtime: { mode: config.runtime.defaultMode, workspace: config.workspace.root, currentDate },
        tools: createCliBuiltInTools(options, config),
        maxSteps: 8
      })
    };

    const allTools = [...builtInTools, createSpawnSubagentTool(factory)];

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
        systemInstruction: "You are ArvinClaw, a personal general-purpose agent. You can use tools to read files, list directories, write files, run shell commands, and read web pages. You follow a permission policy that governs which actions require user approval.",
        runtime: {
          mode: config.runtime.defaultMode,
          workspace: config.workspace.root,
          currentDate
        },
        tools: allTools,
        skillIndex,
        preferStreaming: sessionOptions.preferStreaming ?? false,
        approvalResolver,
        ...(config.runtime.promptMode !== undefined ? { promptMode: config.runtime.promptMode } : {})
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
    createShellTool(),
    createReadWebPageTool(options.fetch)
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
      maxTokens: config.model.maxTokens
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
      lines.push(`This skill was installed from an external source and has not been trusted. Run \`arvinclaw skills trust ${name}\` to trust it.`);
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
      return "Started tool";
    case "tool_completed":
      return "Completed tool";
    case "tool_failed":
      return "Failed tool";
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

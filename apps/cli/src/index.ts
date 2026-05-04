/**
 * INPUT: CLI arguments, package version, optional line reader/fetch implementation, optional fake model outputs, config loader, runtime/session packages, context assembler, and model providers.
 * OUTPUT: CLI result objects, configured/fake interactive chat transcript, approval prompts, short-term session memory, latest-session resume behavior, persisted trace output, assistant text, compact trace output, redacted config output, slash command output, and terminal stdout/stderr side effects.
 * POS: CLI adapter layer; translates terminal commands and approval prompts without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, type EffectiveConfig, type RedactedConfigView } from "@arvinclaw/config";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, type ApprovalResolver, type RuntimeEvent, type RuntimeTraceStore } from "@arvinclaw/core";
import { FakeModelProvider, OpenAICompatibleProvider, type ModelInput, type ModelOutput, type ModelProvider } from "@arvinclaw/models";
import { InMemorySessionStore, JsonlSessionStore, type SessionStore } from "@arvinclaw/sessions";

export const cliPackageName = "@arvinclaw/cli";

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
    CliChatSession.createConfigured(config, options, sessionId === undefined ? {} : { sessionId }),
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
    "/exit    Leave chat"
  ];
}

export interface CliChatTurnResult {
  assistantText: string;
  approvalLines: string[];
  events: RuntimeEvent[];
}

interface CreateChatSessionOptions {
  sessionId?: string;
}

export class CliChatSession {
  readonly #runtime: AgentRuntime;
  readonly #traceStore: RuntimeTraceStore;
  readonly #sessionStore: SessionStore;
  readonly #sessionId: string;
  readonly #config: RedactedConfigView;
  readonly #recentMessageLimit: number;
  readonly #approvalPromptLog: string[];

  constructor(
    runtime: AgentRuntime,
    config: RedactedConfigView = redactedConfig(loadConfig()),
    traceStore: RuntimeTraceStore = new InMemoryRuntimeTraceStore(),
    sessionId = createSessionId(),
    sessionStore: SessionStore = new InMemorySessionStore({ createSessionId: () => sessionId }),
    recentMessageLimit = 12,
    approvalPromptLog: string[] = []
  ) {
    this.#runtime = runtime;
    this.#config = config;
    this.#traceStore = traceStore;
    this.#sessionStore = sessionStore;
    this.#sessionId = sessionId;
    this.#recentMessageLimit = recentMessageLimit;
    this.#approvalPromptLog = approvalPromptLog;
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
        systemInstruction: "You are ArvinClaw, a CLI-first OpenClaw-like learning agent.",
        runtime: {
          mode: "confirm",
          workspace: process.cwd(),
          currentDate: new Date().toISOString().slice(0, 10)
        },
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

  static createConfigured(config: EffectiveConfig, options: RunCliOptions = {}, sessionOptions: CreateChatSessionOptions = {}): CliChatSession {
    if (config.secrets.apiKey === undefined) {
      throw new Error("Configured chat requires an API key.");
    }

    const sessionId = sessionOptions.sessionId ?? createSessionId();

    const currentDate = new Date().toISOString().slice(0, 10);
    const approvalPromptLog: string[] = [];

    return new CliChatSession(
      new AgentRuntime({
        contextAssembler: createCliContextAssembler(config, currentDate),
        modelProvider: new OpenAICompatibleProvider({
          baseURL: config.model.baseURL,
          apiKey: config.secrets.apiKey,
          model: config.model.model,
          temperature: config.model.temperature,
          maxTokens: config.model.maxTokens,
          ...(options.fetch ? { fetch: options.fetch } : {})
        }),
        systemInstruction: "You are ArvinClaw, a CLI-first OpenClaw-like learning agent.",
        runtime: {
          mode: config.runtime.defaultMode,
          workspace: config.workspace.root,
          currentDate
        },
        approvalResolver: createCliApprovalResolver(options, approvalPromptLog)
      }),
      redactedConfig(config),
      new InMemoryRuntimeTraceStore(),
      sessionId,
      createConfiguredSessionStore(config, options, sessionId),
      12,
      approvalPromptLog
    );
  }

  async sendMessage(message: string): Promise<CliChatTurnResult> {
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
        approvalPromptLog.push("Decision: approved once (tool execution is not wired yet).");
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

function createConfiguredSessionStore(config: EffectiveConfig, options: RunCliOptions, sessionId: string): SessionStore {
  const directory = resolveSessionsDirectory(options.sessionsDirectory ?? config.sessions.directory, options.env);

  // The configured CLI path uses JSONL so named sessions can be replayed across
  // process runs; tests can still inject a temp directory to avoid user files.
  return new JsonlSessionStore({
    directory,
    createSessionId: () => sessionId
  });
}

function createCliContextAssembler(config: RedactedConfigView | EffectiveConfig, currentDate: string): DefaultContextAssembler {
  const workspacePromptFiles = ["AGENTS.md", "SOUL.md"];

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

function resolveSessionsDirectory(directory: string, env: Record<string, string | undefined> | undefined): string {
  if (!directory.startsWith("~/")) {
    return directory;
  }

  const home = env?.HOME ?? process.env.HOME;

  return home === undefined ? directory : join(home, directory.slice(2));
}

function createSessionId(): string {
  return `session_${crypto.randomUUID()}`;
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
    case "model_request_started":
      return "Started model request";
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
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const lineIterator = terminal[Symbol.asyncIterator]();

  const result = await runCli(process.argv.slice(2), "0.0.0", {
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

/**
 * INPUT: CLI arguments, package version, optional line reader, config loader, runtime package, context assembler, and fake model provider.
 * OUTPUT: CLI result objects, interactive chat transcript, assistant text, compact trace output, redacted config output, slash command output, and terminal stdout/stderr side effects.
 * POS: CLI adapter layer; translates terminal commands without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, type RedactedConfigView } from "@arvinclaw/config";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, type RuntimeEvent, type RuntimeTraceStore } from "@arvinclaw/core";
import { FakeModelProvider, type ModelInput, type ModelOutput, type ModelProvider } from "@arvinclaw/models";

export const cliPackageName = "@arvinclaw/cli";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  readLine?: (prompt: string) => Promise<string | undefined>;
  write?: (text: string) => void;
}

const helpText = `Usage: arvinclaw <command>

Commands:
  chat        Start an interactive chat session
  chat --fake <message>
              Run one message-only turn with a fake provider
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
    if (rest[0] === "--fake") {
      return runFakeChatTurn(parseFakeChatArgs(rest.slice(1)), options);
    }

    return runInteractiveFakeChat(options);
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

async function runInteractiveFakeChat(options: RunCliOptions): Promise<CliResult> {
  const session = CliChatSession.createFake((message) => `Fake response to: ${message}`, options);
  const output: string[] = [];
  const emit = (...lines: string[]) => {
    if (options.write) {
      options.write(`${lines.join("\n")}\n`);
    } else {
      output.push(...lines);
    }
  };

  emit(
    "ArvinClaw chat (fake provider)",
    "Type /help for commands or /exit to leave.",
    ""
  );

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
  events: RuntimeEvent[];
}

export class CliChatSession {
  readonly #runtime: AgentRuntime;
  readonly #traceStore: RuntimeTraceStore;
  readonly #config: RedactedConfigView;

  constructor(
    runtime: AgentRuntime,
    config: RedactedConfigView = redactedConfig(loadConfig()),
    traceStore: RuntimeTraceStore = new InMemoryRuntimeTraceStore()
  ) {
    this.#runtime = runtime;
    this.#config = config;
    this.#traceStore = traceStore;
  }

  static createFake(responseContent: string | ((message: string) => string) = "Fake response to: Hello trace", options: RunCliOptions = {}): CliChatSession {
    const config = redactedConfig(loadConfig(options.env ? { env: options.env } : {}));
    const provider =
      typeof responseContent === "function"
        ? new MessageMappedFakeModelProvider(responseContent)
        : new FakeModelProvider([
            {
              type: "message",
              content: responseContent
            }
          ]);

    return new CliChatSession(
      new AgentRuntime({
        contextAssembler: new DefaultContextAssembler(),
        modelProvider: provider,
        systemInstruction: "You are ArvinClaw, a CLI-first OpenClaw-like learning agent.",
        runtime: {
          mode: "confirm",
          workspace: process.cwd(),
          currentDate: new Date().toISOString().slice(0, 10)
        }
      }),
      config
    );
  }

  async sendMessage(message: string): Promise<CliChatTurnResult> {
    const events: RuntimeEvent[] = [];

    for await (const event of this.#runtime.runTurn({ message })) {
      await this.#traceStore.append(event);
      events.push(event);
    }

    const assistantMessage = events.find((event) => event.type === "assistant_message_created");

    return {
      assistantText:
        assistantMessage?.type === "assistant_message_created"
          ? assistantMessage.message.content
          : "No assistant message was produced.",
      events
    };
  }

  async runSlashCommand(command: string): Promise<string[]> {
    if (command === "/trace") {
      return renderCompactTrace(await this.#traceStore.listRecent());
    }

    if (command === "/config") {
      return renderRedactedConfig(this.#config);
    }

    return [`Unknown slash command: ${command}`];
  }
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

export function renderRedactedConfig(config: RedactedConfigView): string[] {
  return [
    `Provider: ${config.model.provider}`,
    `Model: ${config.model.model}`,
    `Base URL: ${config.model.baseURL}`,
    `Default mode: ${config.runtime.defaultMode}`,
    `Trace verbosity: ${config.trace.verbosity}`,
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

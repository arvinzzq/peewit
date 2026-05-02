/**
 * INPUT: CLI arguments, package version, runtime package, context assembler, and fake model provider.
 * OUTPUT: CLI result objects, assistant text, compact trace output, slash command output, and terminal stdout/stderr side effects.
 * POS: CLI adapter layer; translates terminal commands without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { fileURLToPath } from "node:url";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { AgentRuntime, InMemoryRuntimeTraceStore, type RuntimeEvent, type RuntimeTraceStore } from "@arvinclaw/core";
import { FakeModelProvider } from "@arvinclaw/models";

export const cliPackageName = "@arvinclaw/cli";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const helpText = `Usage: arvinclaw <command>

Commands:
  chat        Start an interactive chat session
  chat --fake <message>
              Run one message-only turn with a fake provider
  --help      Show this help message
  --version   Show the CLI version
`;

export async function runCli(args: string[], packageVersion: string): Promise<CliResult> {
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
      return runFakeChatTurn(parseFakeChatArgs(rest.slice(1)));
    }

    return {
      exitCode: 0,
      stdout: "arvinclaw interactive chat is not wired yet. Use `arvinclaw chat --fake <message>` for the Phase 1 smoke path.\n",
      stderr: ""
    };
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

async function runFakeChatTurn(input: ParsedFakeChatArgs): Promise<CliResult> {
  const { message, slashCommands } = input;

  if (message.trim() === "") {
    return {
      exitCode: 1,
      stdout: helpText,
      stderr: "Missing message for `chat --fake`.\n"
    };
  }

  const session = CliChatSession.createFake(`Fake response to: ${message}`);
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

async function renderSlashCommands(session: CliChatSession, slashCommands: string[]): Promise<string> {
  const rendered: string[] = [];

  for (const command of slashCommands) {
    if (command === "/trace") {
      rendered.push(["", "Recent Trace:", ...(await session.runSlashCommand(command))].join("\n"));
    } else {
      rendered.push(["", `Unknown slash command: ${command}`].join("\n"));
    }
  }

  return rendered.length === 0 ? "" : `${rendered.join("\n")}\n`;
}

export interface CliChatTurnResult {
  assistantText: string;
  events: RuntimeEvent[];
}

export class CliChatSession {
  readonly #runtime: AgentRuntime;
  readonly #traceStore: RuntimeTraceStore;

  constructor(runtime: AgentRuntime, traceStore: RuntimeTraceStore = new InMemoryRuntimeTraceStore()) {
    this.#runtime = runtime;
    this.#traceStore = traceStore;
  }

  static createFake(responseContent = "Fake response to: Hello trace"): CliChatSession {
    return new CliChatSession(
      new AgentRuntime({
        contextAssembler: new DefaultContextAssembler(),
        modelProvider: new FakeModelProvider([
          {
            type: "message",
            content: responseContent
          }
        ]),
        systemInstruction: "You are ArvinClaw, a CLI-first OpenClaw-like learning agent.",
        runtime: {
          mode: "confirm",
          workspace: process.cwd(),
          currentDate: new Date().toISOString().slice(0, 10)
        }
      })
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
    if (command !== "/trace") {
      return [`Unknown slash command: ${command}`];
    }

    return renderCompactTrace(await this.#traceStore.listRecent());
  }
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
  const result = await runCli(process.argv.slice(2), "0.0.0");
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

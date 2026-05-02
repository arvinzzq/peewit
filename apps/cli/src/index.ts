/**
 * INPUT: CLI arguments, package version, and Node process streams in direct execution mode.
 * OUTPUT: CLI result objects and terminal stdout/stderr side effects from main().
 * POS: CLI adapter layer; translates terminal commands without owning agent behavior.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { fileURLToPath } from "node:url";

export const cliPackageName = "@arvinclaw/cli";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const helpText = `Usage: arvinclaw <command>

Commands:
  chat        Start an interactive chat session
  --help      Show this help message
  --version   Show the CLI version
`;

export async function runCli(args: string[], packageVersion: string): Promise<CliResult> {
  const [command] = args;

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
    return {
      exitCode: 0,
      stdout: "arvinclaw chat is planned for Phase 1. Phase 0 only provides the CLI shell.\n",
      stderr: ""
    };
  }

  return {
    exitCode: 1,
    stdout: helpText,
    stderr: `Unknown command "${command}".\n`
  };
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

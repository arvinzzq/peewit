# Module 14: apps/cli

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `14-cli.zh-CN.md`

Related source: `apps/cli/src/index.ts`

## 0. How to Use This Document

This document is part of Stage 5 (System Synthesis) in the [learning guide](./guide.md).
Read it last — `apps/cli` is the assembly point for every other module. Before reading,
you should already understand `@vole/core`, `@vole/sessions`, `@vole/tools`, `@vole/config`,
`@vole/skills`, `@vole/scheduler`, `@vole/gateway`, and `@vole/adapters`.

**Before reading**: Grep the file for `CliChatSession` and trace the two factory methods
(`createFake` and `createConfigured`). Then read `sendMessage` — it is the most important
method in the CLI. Finally, trace `runCli` to understand how commands are routed.

**Focus questions**:
- `RunCliOptions` has six injectable fields. What real capabilities does each one fake for
  tests, and what is the production default?
- `CliChatSession.createConfigured` wires together eight packages. List each and explain
  what it provides.
- `sendMessage` handles three distinct event types specially. Which are they, and what does
  each persist?
- Slash commands are handled at two levels. Which commands are handled in the loop directly,
  and which are delegated to `CliChatSession.runSlashCommand`? Why the split?

**Checkpoint**: You understand this module when you can describe the complete path from
`vole chat` on the command line to the first assistant response appearing in the terminal,
naming every package touched.

## 1. What This Module Does

**Plain language**: The CLI is the stage manager of a theatre production. Every other module
is a specialist: the lighting crew (`@vole/models`), the props department (`@vole/tools`), the
script supervisor (`@vole/context`), the stage door log (`@vole/sessions`). The stage manager
doesn't do any of their jobs — it knows who to call, in what order, and wires them all
together before the curtain rises.

**Technical summary**: `apps/cli` is the terminal adapter. It exposes `runCli` as the main
entry point, which routes to subcommands (`chat`, `run`, `sessions`, `tasks`, `skills`,
`daemon`, `taskflow`). The core of the adapter is `CliChatSession`, a class that assembles
`AgentRuntime` with all its dependencies — model provider, tools, context assembler, session
store, approval resolver, skill index, gateway — and drives the interactive turn loop. All
external I/O (readline, stdout, fetch) is injectable, making the entire CLI testable without
a terminal.

## 2. Architecture: Dependency Assembly

`CliChatSession.createConfigured` is the system's main wiring point. It calls into eight
packages in one function:

```
loadConfig()              → @vole/config      – validated runtime settings
SkillLoader.load()        → @vole/skills       – skill definitions + skill index
createCliBuiltInTools()   → @vole/tools        – all available tools
createCliApprovalResolver → inline             – interactive readline resolver
createConfiguredProvider  → @vole/models       – Anthropic or OpenRouter provider
createCliContextAssembler → @vole/context      – DefaultContextAssembler with workspace files
JsonlSessionStore         → @vole/sessions     – message + trace persistence
SessionGateway.register   → @vole/gateway      – registers session as active
filterToolsByProfile      → @vole/adapters     – applies VOLE_TOOL_PROFILE restriction
AgentRuntime              → @vole/core         – the agent loop
```

No other file in the codebase touches all ten of these. The CLI is the only place where
the full system is assembled.

## 3. Public Interface

```ts
// All external I/O — fully injectable for testing
interface RunCliOptions {
  env?: Record<string, string | undefined>  // override process.env
  fakeModelOutputs?: ModelOutput[]          // use FakeModelProvider
  fetch?: FetchLike                         // override global fetch
  readLine?: (prompt: string) => Promise<string | undefined>  // stdin
  sessionsDirectory?: string                // override sessions path
  write?: (text: string) => void            // stdout
}

// Return value of every CLI command
interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

// Main entry point — pure function over args
async function runCli(args: string[], packageVersion: string, options?: RunCliOptions): Promise<CliResult>

// The interactive session object
class CliChatSession {
  static createFake(...): CliChatSession        // test factory
  static async createConfigured(...): Promise<CliChatSession>  // production factory
  async sendMessage(message, opts?): Promise<CliChatTurnResult>
  async runSlashCommand(command): Promise<string[]>
  close(): void
}
```

## 4. Implementation Walkthrough

### runCli: the command router

```ts
export async function runCli(args, packageVersion, options = {}): Promise<CliResult> {
  const [command, ...rest] = args;
  if (command === "chat")     return runInteractiveConfiguredChat(options, parsedArgs);
  if (command === "run")      return runBackgroundTask(...);
  if (command === "sessions") return runListSessions(options);
  if (command === "tasks")    return runListTasks(options, limit);
  if (command === "skills")   return runSkillsCommand(rest, options);
  if (command === "daemon")   return runDaemon(options, once);
  if (command === "taskflow") return runTaskflowCommand(rest, options);
  if (command === "gateway")  return runGatewayStatus(options);
  // ...
}
```

Pure dispatch — no business logic in the router itself. Every branch returns a `CliResult`
with `exitCode`, `stdout`, `stderr`. The entire CLI is a function from args to a result,
making it trivially testable.

`vole gateway status` (Phase 11 Step 6) prints two views: the in-process gateway state for this CLI invocation (lane occupancy, active runs — usually empty for a one-shot CLI call) and the cross-process view, which scans the sessions directory for `.lock` sidecars left by other vole processes, reads their pid + startedAt, and marks each entry as `alive` or `stale`. The two views compose: lanes order writes within one Node process; the file lock and the `.lock` view order writes across processes.

### RunCliOptions: six injectable seams

| Field | Production default | What it fakes |
|---|---|---|
| `env` | `process.env` | Config loading without touching real env |
| `fakeModelOutputs` | real model provider | Deterministic model responses |
| `fetch` | global `fetch` | Web page reads without network |
| `readLine` | `readline` from stdin | Interactive input in tests |
| `sessionsDirectory` | from config | Isolated session storage per test |
| `write` | buffered to stdout | Streaming output in tests |

Every test sets `readLine` to return a canned sequence of messages and `write` to capture
output. No terminal, no API key, no filesystem side effects.

### CliChatSession: two factory methods

**`createFake`** — synchronous, uses `FakeModelProvider`, `InMemorySessionStore`. Used in
the test suite for unit tests of the interactive loop.

**`createConfigured`** — async, full production setup:
1. Validates API key is present
2. Loads skills from workspace → builds skill index + skill file map
3. Creates the real model provider (Anthropic or OpenRouter)
4. Builds all tools → applies profile filter
5. Creates `SubagentFactory` for `spawn_subagent`
6. Registers session in `cliGateway`
7. Constructs `AgentRuntime` with everything wired

### sendMessage: the turn engine

From Phase 11 Step 5a forward, the chat run is submitted to a `GatewayCore` rather than calling `runtime.runTurn` directly. The gateway threads the run through the three-tier lane chain (global / subagent / session) defined in `@vole/lanes`, and routes the user-provided `opts.signal` to `gateway.cancel(runId)` so Ctrl+C aborts cleanly:

```ts
async sendMessage(message, opts = {}): Promise<CliChatTurnResult> {
  const recentMessages = await this.#sessionStore.listMessages(this.#sessionId);
  const runId = `run_${crypto.randomUUID()}`;

  if (this.#gateway && opts.signal) {
    opts.signal.addEventListener("abort", () => this.#gateway.cancel(runId), { once: true });
  }

  const eventStream = this.#gateway
    ? this.#gateway.submit<RuntimeEvent>({
        runId,
        sessionKey: this.#sessionId,
        agentId: "default",
        run: async function* (signal) {
          for await (const event of runtime.runTurn({ sessionId, recentMessages, message, signal })) {
            yield event;
          }
        }
      })
    : this.#runtime.runTurn({ sessionId, recentMessages, message, signal: opts.signal });

  for await (const event of eventStream) {
    await this.#traceStore.append(event);
    await this.#sessionStore.appendTraceEvent({ sessionId, event });
    events.push(event);
    opts.onEvent?.(event);

    // Handle compaction persistence
    if (event.type === "compaction_triggered" && event.summary) {
      await this.#sessionStore.appendCompactBoundary({ ... });
    }

    // Handle message persistence
    if (event.type === "turn_complete") {
      for (const msg of event.messages) {
        await this.#sessionStore.appendMessage({ ... });
      }
    }
  }
  // ...
}
```

Three special events:
1. **Every event** → appended to `traceStore` and `sessionStore` as trace records
2. **`compaction_triggered`** → writes a `compact_boundary` record to session JSONL
3. **`turn_complete`** → persists all messages from the turn (user + tool calls + tool results + assistant)

This is where `@vole/core`'s event stream gets translated into `@vole/sessions` persistence. The gateway is a thin orchestrator on the call path — it does not transform events. The `createFake` test path passes no gateway, so `sendMessage` falls back to `runtime.runTurn` directly.

### Slash commands: two levels

**Loop-level** (handled in `runInteractiveLoop` directly):
- `/exit` — breaks the loop
- `/clear` — prints a display-cleared notice
- `/help` — prints help inline

**Session-level** (delegated to `CliChatSession.runSlashCommand`):
- `/trace` — reads trace events from session store, renders compact trace
- `/config` — renders redacted config
- `/skills` — renders skill index

The split exists because loop-level commands need no session state, while session-level
commands need access to `#sessionStore`, `#config`, or `#skillDefinitions`.

### createCliApprovalResolver: interactive approval

```ts
function createCliApprovalResolver(options, approvalPromptLog) {
  return {
    async resolve(request) {
      approvalPromptLog.push("Approval required:", `Tool: ${request.call.name}`, ...);
      const answer = await options.readLine?.("Approve once? [y/N/details] ");
      if (answer === "y" || answer === "yes") {
        return { approved: true, reason: "Approved once from CLI prompt." };
      }
      return { approved: false, reason: "Denied from CLI prompt." };
    }
  };
}
```

Uses `options.readLine` — injectable in tests. Approval decisions are pushed to
`approvalPromptLog` so tests can assert on what was prompted. Note: `"details"` in the
prompt text is not yet implemented — it shows as a choice but doesn't display extra info.

### Session resume

`vole chat --resume` calls `findMostRecentSessionId`, which lists all sessions and picks
the most recently updated one. The session ID is then passed to `createConfigured`, which
creates a `JsonlSessionStore` pre-populated with the existing session's messages. The agent
receives the full message history via `recentMessages` in `sendMessage`.

## 5. Key Design Decisions

**Everything injectable — the CLI is a pure function**

`runCli` takes all I/O via `RunCliOptions`. No direct `console.log`, no direct
`process.stdin`. This is the key design decision that makes the CLI testable: the test
suite imports `runCli` and calls it with fake implementations of all I/O. 1,600 lines of
CLI code are covered without a real terminal.

**`CliChatSession` separates construction from use**

Construction (the two factory methods) assembles all dependencies. The `sendMessage` method
assumes everything is already wired. This makes it easy to test `sendMessage` in isolation
by calling `createFake`, and to test assembly logic in `createConfigured` separately.

**Approval is fire-once, not session-persistent**

The CLI approval resolver approves a single tool call when the user types `y`. It does not
remember approvals across tool calls or turns. This matches the principle of least privilege:
each potentially risky action requires an individual decision.

**`approvalPromptLog` is a shared array, not events**

The approval resolver pushes to a mutable array that `sendMessage` slices to find approvals
from the current turn. This is simpler than emitting approval-prompt events into the event
stream, at the cost of being less composable. It is a pragmatic choice for a single-adapter
system.

**Compaction and message persistence happen at the adapter, not in core**

`@vole/core` emits `compaction_triggered` and `turn_complete` events. `sendMessage` reacts
to these events and calls the session store. This means the persistence policy lives in the
CLI adapter — if a different adapter wanted different persistence behaviour, it would handle
the events differently. Core remains pure: it emits events, it does not write files.

## 6. Testing Approach

Tests are in `apps/cli/src/index.test.ts` (514 lines). All tests use `RunCliOptions` injection:

- No real `process.env` — pass `{ env: { ANTHROPIC_API_KEY: "..." } }`
- No real model — pass `fakeModelOutputs` or use `CliChatSession.createFake`
- No real filesystem — pass `sessionsDirectory` pointing to a temp dir
- No real stdin — pass `readLine` returning a canned sequence of lines
- No real stdout — pass `write` capturing to a string array

Test categories:
- `runCli` routing: each command routes to the right handler
- `CliChatSession.sendMessage`: events produce correct `assistantText`, `todosLines`
- Approval flow: `readLine` returning `"y"` produces `approved: true`
- Slash commands: `/trace`, `/config`, `/skills`, `/help` return expected strings
- Session resume: `--resume` picks up the most recent session
- Background tasks: `run` with `--mode auto` calls the right approval resolver

## 7. Insights

**`apps/cli` is where the system becomes real.** Every other package is an abstraction.
`apps/cli` is the place where `EffectiveConfig` becomes a real `AgentRuntime`, where
`JsonlSessionStore` gets a real file path, where `SkillLoader` gets a real workspace root.
Reading `createConfigured` is reading the system's assembly manual.

**The injectable I/O pattern enables test-driven CLI development.** Because `runCli` is
a pure function of `(args, version, options)`, adding a new command is: write the handler
function, add a branch to `runCli`, write a test that calls `runCli` with the command name
and asserts on `stdout`. No terminal, no environment, no timing.

**`CliChatSession` is not an Ink component.** Ink is a React-based terminal rendering
library. Vole's CLI uses plain text output through the injectable `write` function. This
makes the CLI less visually rich than OpenClaw's terminal UI but far simpler to test and
reason about. The `write` function is called with formatted strings, and the terminal sees
exactly what `write` receives.

**The slash command split is a layering discipline.** Commands that need session internals
(`/trace`, `/config`, `/skills`) are in `CliChatSession` because they access private fields.
Commands that are pure loop control (`/exit`, `/clear`, `/help`) stay in the loop because
they need no session state. Moving loop-control commands into `CliChatSession` would expose
session internals to the loop; moving session commands into the loop would require passing
private fields out.

## 8. Review Questions

1. List the six `RunCliOptions` fields and what each one replaces in production.
   > `env`: replaces `process.env` for config loading. `fakeModelOutputs`: replaces the real
   > model provider with `FakeModelProvider`. `fetch`: replaces global `fetch` for web page
   > reads. `readLine`: replaces stdin readline for interactive input. `sessionsDirectory`:
   > replaces the config-derived sessions path with a test temp dir. `write`: replaces buffered
   > stdout writes with a test-capturable function.

2. What happens in `sendMessage` when a `compaction_triggered` event arrives?
   > If the event has a non-empty `summary`, `sendMessage` calls
   > `sessionStore.appendCompactBoundary` with the summary and message counts. This writes a
   > `compact_boundary` record to the session JSONL. On the next session load, `#replay`
   > in `JsonlSessionStore` will encounter this boundary, discard all messages before it, and
   > insert the summary as a system message — so the agent sees a compressed history.

3. Why is `createConfigured` async but `createFake` synchronous?
   > `createConfigured` calls `SkillLoader.load()` which reads skill files from disk — an
   > async filesystem operation. `createFake` uses `InMemorySessionStore` and an in-process
   > `FakeModelProvider`, neither of which requires I/O.

4. `/trace` is a slash command in `CliChatSession`, but `/exit` is handled in `runInteractiveLoop`.
   Why?
   > `/trace` needs access to `this.#sessionStore` to call `listTraceEvents`. This is a
   > private field of `CliChatSession`. `/exit` needs only to break the loop — it requires
   > no session state. Putting `/exit` inside `CliChatSession` would require exposing session
   > internals to the loop or adding a "should exit" return value to `runSlashCommand`.

5. What is `SubagentFactory` and why is it created inside `createConfigured`?
   > `SubagentFactory` is an interface with one method: `create(goal): AgentRuntime`. It is
   > passed to `createSpawnSubagentTool`, which calls `factory.create(goal)` when the agent
   > invokes `spawn_subagent`. It is created inside `createConfigured` because sub-agents
   > inherit the parent's model provider, context assembler, workspace root, and tool set —
   > all of which are assembled in `createConfigured`. A factory created elsewhere would not
   > have access to these dependencies.

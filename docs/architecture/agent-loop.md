# Agent Loop

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [agent-loop.zh-CN.md](./agent-loop.zh-CN.md)

## 1. Purpose

The agent loop is the runtime cycle that turns a user goal into actions and results.

In ArvinClaw, the loop should be simple enough to learn from, but structured enough to evolve into a real general-purpose agent platform.

The MVP loop should answer these questions:

- What did the user ask for?
- Does the agent need tools?
- Which tool should be used?
- Is the tool action allowed?
- What did the tool return?
- What should the agent do next?
- When is the task finished?

## 2. Core Idea

At a high level, the loop is:

```text
User goal
  -> Build model context
  -> Ask model for next step
  -> If model requests a tool, evaluate permission
  -> Execute approved tool
  -> Add observation to context
  -> Repeat until final answer
```

This is the smallest useful shape of a general agent. It lets the model reason over the goal, choose actions, observe results, and continue.

## 3. MVP Loop

The Phase 1 MVP should start with a direct tool-calling loop.

```mermaid
flowchart TD
  A["User sends message"] --> B["Agent builds context"]
  B --> C["ModelProvider generates response"]
  C --> D{"Tool call requested?"}
  D -- "No" --> E["Return final response"]
  D -- "Yes" --> F["Create tool action"]
  F --> G["Evaluate permission"]
  G --> H{"Allowed?"}
  H -- "Denied" --> I["Add denial observation"]
  H -- "Needs approval" --> J["Ask adapter for approval"]
  H -- "Allowed" --> K["Execute tool"]
  J --> L{"User approved?"}
  L -- "No" --> I
  L -- "Yes" --> K
  K --> M["Record tool result"]
  I --> N["Record trace event"]
  M --> N
  N --> B
```

The loop should stop when:

- The model returns a final response.
- The maximum step count is reached.
- A required permission is denied.
- A tool fails in a way the agent cannot recover from.
- The user cancels the task.

## 4. Main Components

### Agent Core

Owns the loop and coordinates the other modules.

Responsibilities:

- Accept a user message or goal
- Build model context
- Call the model provider
- Interpret model responses
- Coordinate tool execution
- Record trace events
- Return final output to the adapter

### Model Provider

Turns structured messages and available tools into a model response.

The core should call `ModelProvider`, not a vendor SDK directly.

### Tool Registry

Provides the list of tools available to the agent and resolves tool calls by name.

The registry should describe:

- Tool name
- Description
- Input schema
- Risk metadata
- Execution function

### Permission Policy

Evaluates whether a tool action can run automatically, needs approval, or must be blocked.

The permission policy returns a decision. It does not ask the user directly. The active adapter handles user interaction.

### Adapter

Presents the loop to a user or external system.

In Phase 1, the adapter is CLI. Later adapters may include Web UI, desktop app, messaging platforms, or background automation.

### Trace Recorder

Records the product-level explanation of what happened during the loop.

The trace should explain the execution process without exposing hidden model reasoning.

## 5. Loop Inputs and Outputs

### Inputs

The loop receives:

- User message or goal
- Session context
- Loaded skills
- Available tools
- Current autonomy mode
- Effective configuration
- Permission policy

### Outputs

The loop returns:

- Final assistant response
- Trace events
- Updated session state
- Tool results that should be persisted
- Any unresolved approval or error state

## 6. Context Building

Before calling the model, the core builds context from:

- System instructions
- Active autonomy mode
- Relevant skill instructions
- Conversation history
- Current plan, if any
- Recent trace summaries
- Available tool descriptions
- User message

The context should be assembled by the core, but each package should own its own contribution:

- `packages/skills` provides selected skill summaries.
- `packages/tools` provides tool descriptions.
- `packages/sessions` provides conversation and trace history.
- `packages/permissions` provides policy language when needed.

## 7. Tool Calling

A model response may contain:

- A final answer
- One or more tool calls
- A request for clarification
- A structured plan update in later phases

The MVP can support one tool call per loop step first. Multiple tool calls can be added later once trace and permission behavior are clear.

Tool execution should follow this sequence:

```text
Parse tool call
  -> Validate tool exists
  -> Validate input schema
  -> Classify action risk
  -> Evaluate permission
  -> Ask adapter for approval if needed
  -> Execute tool
  -> Normalize result
  -> Record trace
  -> Feed observation back into model context
```

## 8. Permission Interaction

The loop must not execute a tool just because the model requested it.

Every tool call passes through permission evaluation:

- Low risk: may run automatically in `confirm` and `auto`
- Medium risk: requires confirmation
- High risk: requires explicit confirmation with risk explanation
- Blocked: denied unless configuration explicitly allows it

Autonomy modes change how much the loop pauses, but they do not remove permission checks.

## 9. Autonomy Modes in the Loop

### `observe`

The loop pauses before most actions and shows what it is about to do. This is best for learning and debugging.

### `confirm`

The loop automatically performs low-risk actions and asks before medium or high-risk actions. This should be the default MVP product mode.

### `auto`

The loop continues without routine interruption inside the permission policy. It still stops for blocked actions, failed tasks, or configured high-risk approvals.

## 10. Execution Trace

Every meaningful step should produce a trace event.

Trace events may include:

- User goal received
- Context built
- Model response received
- Tool selected
- Permission decision made
- User approval requested
- Tool executed
- Tool result observed
- Final response produced
- Error or cancellation occurred

The trace is for product understanding and learning. It should not include hidden chain-of-thought content.

## 11. Event Stream Shape

The runtime should expose the loop as an event stream, not only as one final result.

In TypeScript, Phase 1 uses `AsyncIterable<RuntimeEvent>` for `AgentRuntime.runTurn`. This lets adapters consume each event as the run advances:

```ts
for await (const event of runtime.runTurn(input)) {
  await traceStore.append(event);
}
```

A plain `async` function returning `RuntimeEvent[]` could represent the same events after the run completes, but it would make the CLI, Web UI, trace viewer, permission prompts, and tool progress wait until the whole turn is over. The event stream shape keeps the runtime observable while it is running.

This is also useful for learning: a user can see the agent move from user message, to context assembly, to model request, to assistant message, instead of treating the agent as a black box.

## 12. Planner Evolution

The MVP loop can run without a full Planner. It only needs enough structure to support traceable tool use.

Later phases add planning:

```text
User goal
  -> Create or update plan
  -> Select next step
  -> Run tool/model loop for the step
  -> Observe result
  -> Mark step complete/failed/skipped
  -> Update plan
  -> Continue until task complete
```

The Planner should be introduced as an extension of the loop, not as a separate competing runtime.

### Plan, TodoWrite, and TaskFlow — Three Different Concepts

ArvinClaw Phase 4 introduces a `Plan` construct. It is important to distinguish this from similar-sounding concepts in other systems:

| | ArvinClaw Plan | Claude Code TodoWrite | OpenClaw TaskFlow |
| --- | --- | --- | --- |
| Storage | In-memory (one turn) | In-context (one turn) | SQLite (persistent) |
| Lifecycle | Created at turn start | Model calls on demand | Durable across sessions |
| Driven by | AgentRuntime (infra) | Model (tool call) | TaskFlow engine (infra) |
| Status states | pending / running / complete / failed / skipped | pending / in_progress / completed | 7 states incl. blocked / lost |
| Multi-agent | No | No | Yes (parent/child) |
| Purpose | Decompose goal into steps for the current turn | Show progress to user in-turn | Background job orchestration |

**ArvinClaw Plan** is closest to Claude Code's `TodoWrite` in purpose — both are ephemeral and represent progress within one agent turn. The key architectural difference: ArvinClaw's Plan is driven by infrastructure (`AgentRuntime`) and created via `create_plan` tool injection, whereas Claude Code's `TodoWrite` is a plain tool the model calls directly with no infrastructure orchestration.

**OpenClaw TaskFlow** is a full durable pipeline engine backed by SQLite. It has 7 status states, parent/child task relationships, and multi-agent coordination. This is fundamentally different from either in-turn construct. ArvinClaw should not attempt TaskFlow-equivalent persistence until Phase 8+ (background automation), when background execution patterns are actually needed.

Source: confirmed from OpenClaw source research 2026-05-04. See `docs/research/openclaw-implementation-notes.md` Section 7.

## 13. Failure Handling

The loop should handle failures explicitly:

- Model provider error
- Invalid tool call
- Unknown tool
- Permission denied
- Tool execution error
- Tool timeout
- Repeated unproductive steps
- User cancellation

MVP behavior can be simple:

- Record the failure in trace
- Explain the failure to the user
- Ask for clarification or stop safely

Later versions can add retries, fallback providers, plan repair, and recovery strategies.

## 14. Step Limits

The loop should have a maximum step count per user turn or task. This prevents runaway execution.

Initial defaults can be conservative:

- Chat turn without tools: 1 model step
- Tool-using turn: limited number of tool loop iterations
- `auto` mode: higher limit, still bounded

The exact numbers can be chosen during implementation.

## 15. Minimal Interfaces

The implementation plan should refine these interfaces, but the architecture expects concepts like:

```ts
interface AgentRuntime {
  runTurn(input: AgentTurnInput): AsyncIterable<RuntimeEvent>;
}

interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
}

interface Tool {
  name: string;
  description: string;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

interface PermissionPolicy {
  evaluate(action: ToolAction, context: PermissionContext): PermissionDecision;
}
```

These are illustrative, not final implementation contracts.

## 16. Acceptance Criteria

The first agent loop implementation should be considered successful when:

- The CLI can send a user message into Agent Core.
- Agent Core can call a `ModelProvider`.
- The model can return either a final answer or a tool request.
- Tool requests go through validation and permission evaluation.
- Approved tools execute and return observations.
- Observations can be fed back into the model.
- The loop stops safely.
- The user can see an explainable trace of the process.

## 17. Related Documents

- [Main design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Project structure](./project-structure.md)
- [CLI adapter](./cli-adapter.md)
- [Run queue](./run-queue.md)

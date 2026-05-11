# Execution Contract

Status: Design
Date: 2026-05-11

Simplified Chinese version: [execution-contract.zh-CN.md](./execution-contract.zh-CN.md)

## 1. Purpose

The execution contract controls how strictly the agent runtime enforces execution discipline and how much of the system prompt is rendered per run.

Different use cases demand different trade-offs:

- An interactive chat session needs a minimal footprint — low latency, readable responses, low token cost.
- An autonomous coding agent needs maximum enforcement — tight stall detection, forced tool use, mandatory task tracking.
- A background automation job needs a stripped prompt — no identity preamble, no help text, just task instructions.

The execution contract captures these trade-offs in a single configurable type, making them explicit and testable.

## 2. ExecutionContract Type

```typescript
type ExecutionContract = "default" | "strict-agentic";
```

The contract is set per run via `RunOptions`. If not specified, `"default"` is used.

```typescript
interface RunOptions {
  executionContract?: ExecutionContract;
  promptMode?: PromptMode;
  thinkingBudget?: ThinkingBudget;
  // ... other run options
}
```

## 3. Strict-Agentic Behavior

When `executionContract` is `"strict-agentic"`, `AgentRuntime` applies tighter execution rules:

| Setting | Default | Strict-Agentic |
| --- | --- | --- |
| Max stall turns before abort | 3 | 5 |
| Stall retry instruction | Brief reminder | Forceful: "You must call a tool now." |
| `update_todos` enforcement | Optional | Auto-registered and required |
| Anti-planning guard | Enabled | Stricter pattern matching |
| Empty tool response treatment | Warning | Hard stall increment |

Stall detection in strict-agentic mode matches:

- Turns where the model produced text but zero tool calls
- Turns that contain planning-language patterns (`"I'll start by"`, `"First, I will"`, `"My plan is"`, `"Step 1:"`)
- Turns that contain only a list of steps without any tool invocation

In strict-agentic mode, `update_todos` is automatically added to the tool registry for the run if not already present. The anti-stall retry instruction explicitly names `update_todos` as the minimum acceptable tool call.

## 4. Prompt Modes

Prompt mode controls which sections of the system prompt are rendered:

```typescript
type PromptMode = "full" | "minimal" | "none";
```

| Mode | What is rendered |
| --- | --- |
| `full` | All sections: identity, runtime context, tool descriptions, skill index, safety guidance, workspace context |
| `minimal` | Runtime context, tool descriptions, task instructions only — no identity preamble, no skill index, no safety prose |
| `none` | Raw task instruction only — no system prompt sections |

`full` is the default for interactive sessions.

`minimal` is intended for background agents and sub-agents where token budget is constrained and the model already has strong execution instructions via the task itself.

`none` is reserved for ultra-constrained scenarios (e.g., evaluation harnesses, unit tests, API integrations where the caller controls the full system prompt externally).

`PromptMode` is applied by `ContextAssembler` when building the system prompt. Sections not included by the active mode are simply not assembled.

## 5. Thinking Budget

Thinking budget controls the model's internal reasoning depth before producing a response:

```typescript
type ThinkingBudget =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "adaptive"
  | "max";
```

| Level | Approximate token budget | Use case |
| --- | --- | --- |
| `off` | 0 (disabled) | Fast responses, simple queries |
| `minimal` | ~512 | Light reasoning, quick tool selection |
| `low` | ~1024 | Standard interactive sessions |
| `medium` | ~4096 | Complex single-step tasks |
| `high` | ~8192 | Multi-step planning and coding |
| `xhigh` | ~16384 | Deep analysis, complex refactors |
| `adaptive` | Dynamic — scales with task complexity | Default for strict-agentic |
| `max` | Model-defined maximum | Research, exhaustive analysis |

`ThinkingBudget` is a future capability. The initial implementation supports only `"off"` (default) and routes the setting to providers that support thinking tokens (currently Anthropic extended thinking). For providers that do not support thinking, the budget setting is silently ignored.

## 6. OpenClaw Alignment

OpenClaw uses `executionContract: "strict-agentic"` for autonomous coding and task execution sessions. Key alignments:

| OpenClaw concept | Vole equivalent |
| --- | --- |
| `executionContract: "strict-agentic"` | `ExecutionContract = "strict-agentic"` |
| `promptMode: "minimal"` | `PromptMode = "minimal"` |
| Forced `update_plan` in agentic runs | Auto-registered `update_todos` in strict-agentic |
| Extended thinking tokens | `ThinkingBudget` interface |
| Background prompt stripping | `PromptMode = "none"` |

OpenClaw's implementation confirms that strict-agentic contract is the primary mode for long-running autonomous tasks, while minimal/none prompt modes reduce overhead in sub-agent and background contexts.

## 7. Acceptance Criteria

The execution contract is considered complete when:

- `RunOptions.executionContract` is read by `AgentRuntime` before each run.
- `"strict-agentic"` mode enforces tighter stall detection thresholds.
- `"strict-agentic"` mode auto-registers `update_todos` if not already present.
- `PromptMode` is forwarded to `ContextAssembler` and controls which sections are emitted.
- `ThinkingBudget` type is defined; `"off"` is the default; Anthropic provider routes thinking tokens when budget is not `"off"`.
- Unit tests cover: default contract behavior, strict-agentic stall increments, prompt mode section suppression.

## 8. Related Documents

- [Agent Loop](./agent-loop.md)
- [Context Engine](./context-engine.md)
- [Prompt Assembly](./prompt-assembly.md)
- [Tool System](./tool-system.md)
- [Background Automation](./background-automation.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Roadmap](../roadmap/overview.md)

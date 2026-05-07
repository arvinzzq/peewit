# Stage 1: Agent Loop Mental Model

Status: Draft
Date: 2026-05-07

Simplified Chinese version: `00-concepts.zh-CN.md` (create alongside this file)

## 1. What Is an Agent?

A chatbot makes one API call and returns one reply. An agent loops: it can choose to take
actions, observe results, and decide what to do next — until the goal is achieved.

```
Chatbot:  user message → model → reply (one shot)

Agent:    user message
            → model: "what should I do next?"
            → execute action
            → observe result
            → model: "am I done? what's next?"
            → repeat until goal met or loop terminates
```

The loop is the fundamental difference. Everything else in the codebase exists to make that
loop safe, observable, persistent, and extensible.

## 2. The Agent Loop

OpenClaw documents the agent loop as five sequential stages:

```
intake → context assembly → model inference → tool execution → streaming / persistence
```

| Stage | What happens |
|---|---|
| **Intake** | Receive user message or scheduled trigger |
| **Context Assembly** | Pack system prompt, conversation history, tool descriptions, skill index into one payload for the model |
| **Model Inference** | Call the model; receive either a text reply or a list of tool calls |
| **Tool Execution** | For each tool call: evaluate permission, execute, collect result |
| **Streaming / Persistence** | Stream output back to the adapter; save the turn to the session store |

The loop then returns to Context Assembly for the next step — this time with the tool results
appended to the message history.

## 3. The Permission System

The model can request any registered tool. Without a gate, one malicious or misconfigured
prompt could delete files, exfiltrate secrets, or execute dangerous commands.

The permission system evaluates every tool call *before* execution. It returns one of four
decisions:

| Decision | Meaning | Who acts |
|---|---|---|
| `allow` | Execute automatically | Loop continues without pause |
| `ask` | Pause and ask the user | Adapter prompts the user; run waits |
| `deny` | Reject — terminate the run | Loop emits `run_failed` immediately |
| `block` | Permanently forbidden by config | Loop emits `run_failed` immediately |

Key boundary: the permission package **evaluates** but does not **interact**. When the
decision is `ask`, the adapter (CLI or web) handles the user interaction. This keeps the
same permission logic working across all interfaces.

## 4. Context Assembly

The model has no memory between calls. It only knows what is in the payload sent to it.

On every loop step, context assembly rebuilds the full payload:
- System prompt (instructions, tool descriptions, skill index, permission guidance)
- All previous messages in the conversation
- All tool calls and their results from earlier in this turn
- The current user message

This is why context assembly runs on every iteration, not once at the start. Each step adds
new observations (tool results) that the model must see before deciding the next action.

Cost implication: more loop steps = more tokens per call. Context compaction (summarizing
old history) exists to keep this manageable over long sessions.

## 5. When the Loop Stops

The loop has six termination conditions:

| Condition | Event emitted | Model sees it? |
|---|---|---|
| Model returns a plain text reply (no tool calls) | `run_completed` | Yes — it's the final answer |
| Max steps reached (default: 12) | `run_failed` | No |
| Model API error | `run_failed` | No |
| Permission `deny` or user says no to `ask` | `run_failed` | No |
| Planning stall retries exhausted | `run_failed` | Gets a retry instruction first |
| Tool not found / execution exception | `tool_failed` → continues | Yes — fed back as a tool result |

The last row reveals an important asymmetry: tool-level failures are fed back to the model
as observations. The model can then decide to try a different approach. Only loop-level
failures (step limit, API error, explicit denial) trigger `run_failed` directly.

## 6. Planning Stall Detection

The model sometimes responds with a written plan instead of taking action:

> "I'll start by reading the file, then analyze the structure, and finally generate the report."

This is a planning stall — the model is narrating what it will do without actually doing it.
Left uncorrected, the loop can spin indefinitely producing plans.

Detection: the runtime scans responses for promise language ("I'll…", "let me…"), plan
headings ("Plan:", "Steps:"), and bullet/numbered lists. Responses longer than 700 characters
or containing completion language ("done", "fixed", "found") are never flagged.

Correction: a retry instruction is injected — "Do not restate the plan. Act now: take the
first concrete tool action you can." If stalls persist past the retry limit, the run
terminates with `run_failed`.

## 7. Key Insights

**The loop is simple; the constraints are not.** Strip away event emission, permission
checks, and compaction — the core loop is just: call model, execute tools, repeat. Every
line of code in the codebase exists to add a constraint that makes this loop safe and useful.

**`deny` stops the run; tool errors do not.** A natural assumption is that any failure stops
the loop. The actual design: tool errors (unknown tool, execution exception) are returned to
the model as observations. The model decides what to do next. Only explicit human/policy
denials and infrastructure errors terminate the run. The model is the decision-maker for
recoverable failures.

**Context is stateless by design.** The fact that context is rebuilt from scratch every step
is not a limitation — it is a design choice. It means every loop step has a complete,
consistent view of everything that happened, with no hidden state.

**Permission and interaction are separate.** The permission package evaluates; adapters
interact. This is why the same `deny` / `ask` / `allow` logic works identically in CLI,
web, and background modes.

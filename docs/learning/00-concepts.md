# Stage 1: Agent Loop Mental Model

Status: Complete
Date: 2026-05-07

Simplified Chinese version: `00-concepts.zh-CN.md` (create alongside this file)

## 0. How to Use This Document

This document is the output of Stage 1 in the [learning guide](./guide.md). It covers the
conceptual foundation only — no source code.

**Before reading**: This document summarises key ideas. To build a durable mental model,
read these primary sources first:

1. `docs/architecture/agent-loop.md` — sections 1–4 (what the loop is, why it exists)
2. `docs/research/openclaw-implementation-notes.md` — sections 1–3 (what OpenClaw confirms)
3. `docs/architecture/openclaw-architecture-map.md` — sections 1–4 (how concepts map to phases)

**Exercise**: After reading the primary sources, draw the agent loop on paper — without
looking at any code. Show: user, model, permission check, tool, observation result, and arrows
for data flow. Annotate what can stop the loop at each point. Then compare with the flowchart
in `docs/architecture/agent-loop.md` section 3.

**Checkpoint**: You have understood this stage when you can answer all seven questions in
Section 8 without reading the answers.

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

## 8. Review Questions

1. What is the fundamental difference between a chatbot and an agent?
   > A chatbot makes one API call and returns one reply. An agent loops: it chooses actions,
   > observes results, and decides what to do next — repeating until the goal is met or the
   > loop terminates. The loop is the defining property.

2. What are the five stages of the OpenClaw agent loop, in order?
   > Intake → Context Assembly → Model Inference → Tool Execution → Streaming / Persistence.
   > After Tool Execution the loop returns to Context Assembly for the next step, with tool
   > results appended to the message history.

3. Why does a permission system need to exist? Give a concrete example of what breaks without one.
   > The model can request any registered tool. Without a gate, a prompt injected from a
   > webpage could instruct the agent to delete files or send data to an external server.
   > The permission system evaluates every tool call before execution and can block, deny,
   > or require human approval.

4. Why is context assembled fresh on every loop step rather than reused from the previous step?
   > The model is stateless — it only knows what is in the current API payload. Each loop
   > step adds new observations (tool results) that the model must see before deciding the
   > next action. Reusing stale context would mean the model reasons over an incomplete picture.

5. A tool call throws an execution exception. Does the run terminate? What does the model see?
   > The run does NOT terminate. The exception is caught, `tool_failed` is emitted, and the
   > error text is returned to the model as a tool result message. The model can then decide
   > to retry, use a different tool, or report the problem. Tool-level failures are observations,
   > not loop-level failures.

6. A tool call returns `deny` from the permission policy. Does the model see the denial?
   > No. `deny` triggers `run_failed` immediately — the run terminates before the denial
   > message is assembled into the conversation. This is by design: `deny` means a human or
   > policy said "stop," not "try something else."

7. What is a planning stall, and why is it a problem for an agent loop?
   > A planning stall occurs when the model responds with a written plan ("I'll first read the
   > file, then analyze it…") without calling any tools. Without detection, the loop can spin
   > indefinitely producing plans but taking no actions. The runtime injects a correction
   > instruction and terminates the run if stalls persist past the retry limit.

# Vole Agent — Learning Guide

Status: Draft
Date: 2026-05-07

Simplified Chinese version: [guide.zh-CN.md](./guide.zh-CN.md)

## 1. Purpose

This guide is the learning curriculum for understanding OpenClaw-style agent architecture from zero,
using the Vole codebase as both the subject and the teaching vehicle.

The companion document [plan.md](./plan.md) is a module reference table ordered by package
dependency. This guide is different: it is organized by conceptual stage, building mental models
before source code.

As you complete each stage, produce a module learning document following the
[module template](./_template.md). These documents are the durable output of the learning process
— they can be read by anyone who wants to understand a specific part of the system without going
through the source again.

Estimated time: 20–26 hours across 5 stages.

## 2. Prerequisites

- Basic TypeScript reading ability: class, interface definitions, async/await
- Some exposure to LLM APIs: you have called Claude or GPT at least once

You do not need prior knowledge of agent systems. This guide teaches that.

## 3. How to Use This Guide

Each stage follows a four-step pattern:

1. **Why** — the mental model this stage builds
2. **Read** — specific files in order
3. **Ask** — questions to answer while reading
4. **Do** — one concrete exercise to verify understanding

Follow stages in order. Architecture documents explain *why* the code is shaped the way it is.
Without the why, implementation looks arbitrary.

After every module session, write a module learning document using `_template.md`. Over time,
these documents become the team's authoritative explanation of the system.

## 4. Stage 1 — What Is an Agent?

### 4.1 Why

A chatbot sends a message and receives a reply. An agent can *choose to take actions*, observe
results, and decide what to do next — in a loop. That distinction is fundamental.

Everything in the Vole codebase exists to make that loop safe (permissions), visible (trace),
persistent (sessions), and extensible (tools, skills, adapters).

This stage builds the mental model only. No code yet.

### 4.2 Read

1. `docs/architecture/agent-loop.md` — sections 1–4
2. `docs/research/openclaw-implementation-notes.md` — sections 1–3
3. `docs/architecture/openclaw-architecture-map.md` — sections 1–4

Read in order. Pause after each section and think before continuing.

### 4.3 Ask

Answer these before moving to Stage 2:

- What makes an agent different from a single LLM API call?
- What are the five stages in OpenClaw's documented agent loop?
- Why does a permission system need to exist? What breaks without one?
- Why is context assembled fresh on every loop step, not cached between steps?

### 4.4 Do

Without opening any code: draw the agent loop on paper. Show the user, the model, the permission
check, the tool, and the observation. Draw arrows for what flows where. Annotate what can stop
the loop at each point.

Then re-read section 2 of `agent-loop.md` and correct your drawing.

---

## 5. Stage 2 — The Core Loop in Code

### 5.1 Why

`@vole/core` is the center of the entire system. Every other package exists to serve the loop or
to stay out of it. Reading core first — before understanding all its dependencies — gives you the
structural frame. You will not understand every line. That is fine. The goal is to see the shape.

### 5.2 Read

1. `docs/architecture/agent-loop.md` — section 15 (interfaces and event types)
2. `packages/core/src/index.ts` — exported public interface
3. `packages/core/src/` — all implementation files
4. `packages/core/src/index.test.ts` — read test names and assertions first

### 5.3 Ask

- What are the 17 `RuntimeEventType` values? In what order do they appear during a normal run?
- Why does `runTurn` return `AsyncGenerator<RuntimeEvent>` instead of `Promise<RuntimeEvent[]>`?
- Where in the loop does permission evaluation happen?
- What is `ContextAssembler`? Why is it injected into `AgentRuntime` rather than constructed inside it?
- What triggers `planning_stall_detected`? What happens after it fires?

### 5.4 Do

Run the project:

```sh
pnpm install
cd apps/cli && pnpm dev
```

Ask the agent: "list the files in the current directory."

Then find the `runTurn` generator in `packages/core/src/`. Add a `console.error` call before
each `yield` statement that logs the event type. Run the CLI again with the same message.
Observe the sequence in your console. Remove the logs when done.

---

## 6. Stage 3 — Foundation Modules

For each module below, the goal is to understand *what problem it solves* and *where it plugs
into the loop*. Start every module with the question: "what would break if this package did not
exist?"

After completing each sub-stage, produce `docs/learning/0N-<name>.md` using `_template.md`.

### 6.1 Models — Vendor Abstraction

**Why**: If `@vole/core` called the Anthropic SDK directly, every model change would require
editing the loop. `ModelProvider` keeps vendor logic in one package.

**Read**: `packages/models/src/`, `docs/architecture/model-provider.md`

**Ask**: What methods does `ModelProvider` expose? What does `StreamingModelProvider` add?
What does `FakeModelProvider` do that the real provider does not? Where does token counting
happen?

**Do**: Open `AnthropicProvider` and `FakeModelProvider`. Write down the method signatures they
share. Compare how each implements `generate()`. What does the fake skip, and why?

---

### 6.2 Permissions — The Safety Layer

**Why**: The model can request any registered tool. Without a gate, one bad prompt could delete
files or exfiltrate secrets. `PermissionPolicy` evaluates every tool call before execution.

**Read**: `packages/permissions/src/`, `docs/architecture/permission-system.md`

**Ask**: What are the four decisions: allow, ask, deny, block? Who calls `evaluate()`? Who
handles user interaction when the result is `ask`? Is it the permissions package or the adapter?

**Do**: Write a new `PermissionPolicy` in a scratch file that returns `{ decision: "ask" }` for
any tool with `risk: "high"` and `{ decision: "allow" }` for everything else. Write it to
satisfy the TypeScript interface without running it.

---

### 6.3 Tools — The Agent's Hands

**Why**: Tools are how the agent acts in the world. Each tool has a name, description, JSON
schema, risk level, and execution function. The tool system registers, validates, and executes
them.

**Read**: `packages/tools/src/`, `docs/architecture/tool-system.md`

**Ask**: What is `ExecutableTool`? What fields does it have? What is `ToolExecutionContext` and
what does it give a tool at execution time? Who validates input schema before execution?

**Do**: Find one file-reading tool and one shell-execution tool. Compare their `risk` values.
Find where `ToolExecutionContext` is constructed and what it contains.

---

### 6.4 Context — What the Model Sees

**Why**: The model only knows what it is told. Every call to the model requires assembling a full
context: system prompt, conversation history, tool descriptions, skill index, workspace files.
`@vole/context` owns this assembly.

**Read**: `packages/context/src/`, `docs/architecture/prompt-assembly.md`,
`docs/architecture/context-engine.md`

**Ask**: What sections make up the system prompt? What is a `ContextSkillSummary`, and how does
it differ from a full skill body? What is cache hinting and why does it reduce API cost?

**Do**: Find where the assembled context is passed to `ModelProvider`. Add a temporary log to
print the system prompt section names. Run the CLI and observe.

---

### 6.5 Sessions — Memory Between Turns

**Why**: Each model call is stateless from the model's perspective. Sessions persist message
history and trace events to disk and reload them at the start of the next turn, giving the agent
continuity.

**Read**: `packages/sessions/src/`, `docs/architecture/session-storage.md`

**Ask**: What is persisted per session? What is the mutex for, and what would happen without it?
When does compaction trigger? What is the difference between a `TraceEvent` and a `ModelMessage`?

**Do**: Run the CLI and conduct a 3-message conversation. Find the session file on disk. Open it.
What is its format? What is stored in the trace section?

---

### 6.6 TaskFlow — In-Turn Progress

**Why**: When running a complex task, the user needs to see progress. The `update_todos` tool
lets the model communicate its current step within a single turn — structurally identical to
Claude Code's `TodoWrite`.

**Read**: `packages/taskflow/src/`, `docs/research/openclaw-implementation-notes.md` section 7

**Ask**: How does `update_todos` differ from OpenClaw's full persistent `TaskFlow` registry?
When does the model call it? Who reads the todo state after the model updates it?

**Do**: Ask the CLI agent to do a multi-step task. Observe todo updates. Read
`packages/taskflow/src/` to see how the tool replaces the entire list on each call.

---

## 7. Stage 4 — Extension Systems

Stage 4 covers the packages that extend the loop beyond basic tool use. After each sub-stage,
produce a module learning document.

### 7.1 Skills — Dynamic Behavior

**Why**: Skills give the agent specialized instructions for specific task types. Rather than
loading all skill bodies into every prompt, the agent loads a compact index and reads the full
skill body only when triggered — progressive disclosure.

**Read**: `packages/skills/src/`, `docs/architecture/skill-system.md`, `skills/` directory

**Ask**: What fields does a skill frontmatter contain? When is the full skill body loaded vs.
only indexed? Who decides whether a skill is relevant to the current task?

**Do**: Read one `SKILL.md` file in the `skills/` directory. Identify every frontmatter field.
Write a minimal skill file in a scratch location with `name` and `description` only.

---

### 7.2 Adapters — Tool Profiles

**Why**: Different surfaces need different tool sets. A coding agent needs file and shell access.
A messaging agent should not execute shell commands. Tool profiles define which tools to
instantiate per context.

**Read**: `packages/adapters/src/`, `docs/architecture/adapters.md`

**Ask**: What are the three profiles: `coding`, `full`, `messaging`? Which tools does each
include? What architectural boundary does this enforce?

**Do**: Find where each profile's tool list is defined. List the tools present in `coding` that
are absent from `messaging`. Write one sentence explaining why each was excluded.

---

### 7.3 Scheduler — Background Runs

**Why**: Agents are not only interactive. The scheduler allows running `AgentRuntime` on a cron
schedule or event trigger, without a human in the loop.

**Read**: `packages/scheduler/src/`, `docs/architecture/background-automation.md`

**Ask**: How are cron triggers persisted? What happens if a scheduled run is already in progress
when the next trigger fires? How does the scheduler interact with the gateway?

**Do**: Read the scheduler test for a scheduled trigger. Trace the full lifecycle from trigger
creation to the first `AgentRuntime.runTurn()` call.

---

### 7.4 Gateway — Entry Guard

**Why**: Multiple adapters can attempt to start a session run concurrently. The gateway is the
single entry point that enforces per-session serialization and prevents concurrent runs on the
same session.

**Read**: `packages/gateway/src/`, `docs/architecture/gateway.md`

**Ask**: What does `createSession` do? What does `resumeSession` do differently? Where is
concurrent-run prevention implemented? What is a `runId` and who creates it?

**Do**: Read the gateway source. Find the lock or mutex that prevents concurrent runs. Trace
from an incoming session request to the first `AgentRuntime.runTurn()` call.

---

## 8. Stage 5 — System Synthesis

### 8.1 OpenClaw Comparison

Re-read `docs/research/openclaw-implementation-notes.md` completely. For each OpenClaw concept,
find its Vole equivalent and record it:

| OpenClaw Concept | Vole Equivalent | Phase | Notes |
|---|---|---|---|
| `agent-command.ts` | `AgentRuntime` | Phase 1 | |
| `pi-embedded-runner.ts` | `@vole/core` loop | Phase 1 | |
| `session-store.ts` | `@vole/sessions` | Phase 5 | |
| `update_plan` tool | `update_todos` | Phase 4 | |
| `lanes.ts` (session queues) | `@vole/gateway` | Phase 7 | |
| `incomplete-turn.ts` | stall detection in core | Phase 4 | |

Fill the rest in based on what you know after Stages 2–4.

### 8.2 Architecture Decisions

Read `docs/decisions/`. For each decision record, write answers to:

- What was the alternative that was rejected?
- Why was it rejected?
- What constraint does this decision impose on future phases?

### 8.3 What Was Deferred and Why

Review `docs/roadmap/overview.md` and `docs/architecture/openclaw-architecture-map.md`. Some
OpenClaw features are intentionally deferred to later phases.

For each deferred feature, write one sentence: what it does, why it was not in the MVP, and
which Vole phase introduces it.

---

## 9. Appendix — Reading Tips

**Start with `index.ts`**: Every package's public contract is its exports. Read what is exported
before reading the implementation.

**Tests are documentation**: Test names are honest descriptions of behavior. Read test names and
assertions before reading implementations.

**Follow types first**: Read `interface` and `type` definitions before reading `class` bodies.
Interfaces describe what a module promises; classes describe how.

**Use grep for callers**: When you want to know "who calls X?", run
`grep -r "X" packages/ apps/`. Call sites reveal why something exists.

**Trace one path fully**: Instead of reading all of `@vole/core` breadth-first, trace a single
input end-to-end. Follow "user requests bash execution" through every function call until you
reach the tool result being yielded back to the model.

**Produce the document**: After each module, write `docs/learning/0N-<name>.md`. The act of
writing forces understanding. If you cannot explain a design decision, you have not understood
it yet.

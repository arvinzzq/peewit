# Multi-Agent Runtime

Status: Phase 10
Date: 2026-05-11

Simplified Chinese version: [multi-agent-runtime.zh-CN.md](./multi-agent-runtime.zh-CN.md)

## 1. Purpose

This document describes how Vole supports running multiple `AgentRuntime` instances in a coordinated way, starting with in-process sub-agents in Phase 10.

## 2. Sub-Agent Concept

A sub-agent is a second `AgentRuntime` instance spawned by a parent agent to handle a focused subtask. The parent agent delegates a goal and receives the sub-agent's final text response. The sub-agent runs with its own context, tools, and step limit.

Sub-agents are useful when:

- The subtask requires a separate focused execution context.
- The parent agent wants to hand off a well-defined bounded goal.
- The parent does not want its own conversation history polluted by the subtask steps.

In Phase 10, sub-agents run in-process. They share no memory with the parent agent beyond the `goal` and optional `context` strings passed at spawn time and the result string returned on completion.

## 3. SubagentFactory Interface

The `SubagentFactory` interface decouples the spawn logic from the `createSpawnSubagentTool` function:

```ts
export interface SubagentFactory {
  create(goal: string): AgentRuntime;
}
```

The factory receives the goal string and returns a fully configured `AgentRuntime`. The caller (typically the CLI or Web adapter) is responsible for constructing the factory with the correct config, provider, and tools.

This interface lives in `packages/core` because `AgentRuntime` is defined there. Keeping the factory in core avoids circular imports: tools import nothing from core, and core imports `ExecutableTool` from tools.

## 4. createSpawnSubagentTool

`createSpawnSubagentTool(factory: SubagentFactory): ExecutableTool` returns a tool that the parent agent can call to spawn a sub-agent:

- Tool name: `spawn_subagent`
- Risk: `medium`
- Input: `{ goal: string; context?: string }`
- Output: `{ ok: true; result: string }` on success or `{ ok: false; error: string }` on failure

The tool drives the sub-agent's `runTurn` generator, collects the `assistant_message_created` event, and returns the content as the result. If the sub-agent emits `run_failed`, the tool returns an error result.

## 5. Event Forwarding

In Phase 10, the parent agent does not forward sub-agent runtime events to its own event stream. The sub-agent runs silently from the parent's perspective; only the final result (or error) is returned as the tool's output.

Future phases may add event forwarding for observability.

## 6. Depth Limit

Sub-agents are created with `maxSteps: 8` by default, compared to the parent's `maxSteps: 12`. This limits recursion cost. Sub-agents should not spawn their own sub-agents; the factory used for sub-agents should not include `spawn_subagent` in its tool list.

## 7. References

- [Node Protocol](./node-protocol.md) — future multi-node direction that sub-agents will eventually participate in
- [Gateway](./gateway.md) — session coordination layer that will track sub-agent sessions
- [Agent Loop](./agent-loop.md) — the `AgentRuntime` loop that sub-agents run

import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultContextAssembler } from "@vole/context";
import { FakeModelProvider, FakeStreamingProvider } from "@vole/models";
import { createReadFileTool } from "@vole/tools";
import {
  AgentRuntime,
  InMemoryRuntimeTraceStore,
  SessionMutex,
  createRuntimeEvent,
  isTerminalRuntimeEvent,
  runtimeEventTypes,
  createSpawnSubagentTool,
  createSpawnSubagentAsyncTool,
  type AgentHooks,
  type AsyncTaskStore,
  type RuntimeEvent,
  type SubagentFactory
} from "./index.js";

describe("runtime event contracts", () => {
  test("declares the runtime event vocabulary", () => {
    expect(runtimeEventTypes).toEqual([
      "run_started",
      "context_assembled",
      "compaction_triggered",
      "todos_updated",
      "planning_stall_detected",
      "model_request_started",
      "token_delta",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
      "approval_requested",
      "approval_resolved",
      "tool_started",
      "tool_completed",
      "tool_failed",
      "assistant_message_created",
      "run_completed",
      "run_failed"
    ]);
  });

  test("creates structured runtime events with stable run metadata", () => {
    const event = createRuntimeEvent({
      type: "assistant_message_created",
      eventId: "evt_1",
      runId: "run_1",
      sessionId: "session_1",
      timestamp: "2026-05-03T01:10:00.000Z",
      message: {
        role: "assistant",
        content: "Hello from the fake provider."
      }
    });

    expect(event).toEqual({
      type: "assistant_message_created",
      eventId: "evt_1",
      runId: "run_1",
      sessionId: "session_1",
      timestamp: "2026-05-03T01:10:00.000Z",
      message: {
        role: "assistant",
        content: "Hello from the fake provider."
      }
    });
  });

  test("identifies completed and failed runs as terminal events", () => {
    const completed = createRuntimeEvent({
      type: "run_completed",
      eventId: "evt_completed",
      runId: "run_1",
      timestamp: "2026-05-03T01:10:01.000Z"
    });
    const failed = createRuntimeEvent({
      type: "run_failed",
      eventId: "evt_failed",
      runId: "run_1",
      timestamp: "2026-05-03T01:10:02.000Z",
      error: {
        message: "Provider request failed.",
        recoverable: true
      }
    });
    const nonTerminal: RuntimeEvent = createRuntimeEvent({
      type: "model_request_started",
      eventId: "evt_model",
      runId: "run_1",
      timestamp: "2026-05-03T01:10:03.000Z",
      provider: "fake"
    });

    expect(isTerminalRuntimeEvent(completed)).toBe(true);
    expect(isTerminalRuntimeEvent(failed)).toBe(true);
    expect(isTerminalRuntimeEvent(nonTerminal)).toBe(false);
  });
});

describe("in-memory runtime trace store", () => {
  test("stores runtime events and lists recent events in append order", async () => {
    const store = new InMemoryRuntimeTraceStore();
    const events = [
      createRuntimeEvent({
        type: "run_started",
        eventId: "evt_1",
        runId: "run_1",
        timestamp: "2026-05-03T01:30:00.000Z",
        userMessage: "Hello"
      }),
      createRuntimeEvent({
        type: "context_assembled",
        eventId: "evt_2",
        runId: "run_1",
        timestamp: "2026-05-03T01:30:01.000Z",
        messageCount: 2,
        systemInstructionIncluded: true
      }),
      createRuntimeEvent({
        type: "run_completed",
        eventId: "evt_3",
        runId: "run_1",
        timestamp: "2026-05-03T01:30:02.000Z"
      })
    ];

    for (const event of events) {
      await store.append(event);
    }

    expect(await store.listRecent()).toEqual(events);
    expect(await store.listRecent({ limit: 2 })).toEqual(events.slice(1));
  });

  test("lists events by run id", async () => {
    const store = new InMemoryRuntimeTraceStore();
    const runOne = createRuntimeEvent({
      type: "run_completed",
      eventId: "evt_1",
      runId: "run_1",
      timestamp: "2026-05-03T01:31:00.000Z"
    });
    const runTwo = createRuntimeEvent({
      type: "run_completed",
      eventId: "evt_2",
      runId: "run_2",
      timestamp: "2026-05-03T01:31:01.000Z"
    });

    await store.append(runOne);
    await store.append(runTwo);

    expect(await store.listByRun("run_1")).toEqual([runOne]);
  });
});

describe("message-only AgentRuntime", () => {
  test("emits the successful run event order around context assembly and model generation", async () => {
    const modelProvider = new FakeModelProvider([
      {
        type: "message",
        content: "Hello from runtime."
      }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      systemInstruction: "You are Vole.",
      runtime: {
        mode: "confirm",
        workspace: "/workspace/project",
        currentDate: "2026-05-03"
      },
      createRunId: () => "run_1",
      createEventId: (() => {
        let next = 0;
        return () => `evt_${++next}`;
      })(),
      now: () => "2026-05-03T01:20:00.000Z"
    });

    const events = await collect(runtime.runTurn({ sessionId: "session_1", message: "Hello" }));

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "assistant_message_created",
      "run_completed"
    ]);
    expect(events[4]).toMatchObject({
      type: "assistant_message_created",
      message: {
        role: "assistant",
        content: "Hello from runtime."
      }
    });
    expect(modelProvider.requests[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: "Hello"
    });
  });

  test("emits a failed run when the provider returns a normalized error", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "error",
          category: "network",
          message: "Network unavailable.",
          recoverable: true
        }
      ]),
      systemInstruction: "You are Vole.",
      createRunId: () => "run_2",
      createEventId: (() => {
        let next = 0;
        return () => `evt_fail_${++next}`;
      })(),
      now: () => "2026-05-03T01:21:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Hello" }));

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "run_failed"
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "run_failed",
      error: {
        message: "Network unavailable.",
        recoverable: true
      }
    });
  });

  test("passes recent session messages into context assembly", async () => {
    const modelProvider = new FakeModelProvider([
      {
        type: "message",
        content: "Continuing from session memory."
      }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      systemInstruction: "You are Vole.",
      createRunId: () => "run_memory",
      createEventId: (() => {
        let next = 0;
        return () => `evt_memory_${++next}`;
      })(),
      now: () => "2026-05-03T01:22:00.000Z"
    });

    await collect(
      runtime.runTurn({
        message: "Continue.",
        recentMessages: [
          {
            role: "user",
            content: "Remember this detail."
          },
          {
            role: "assistant",
            content: "I will use it in the next turn."
          }
        ]
      })
    );

    const messages = modelProvider.requests[0]?.messages ?? [];
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[1]).toEqual({ role: "user", content: "Remember this detail." });
    expect(messages[2]).toEqual({ role: "assistant", content: "I will use it in the next turn." });
    expect(messages[3]).toEqual({ role: "user", content: "Continue." });
  });

  test("emits tool call request events when the model requests tools", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [
            {
              id: "call_1",
              name: "read_file",
              input: {
                path: "README.md"
              }
            }
          ]
        }
      ]),
      systemInstruction: "You are Vole.",
      createRunId: () => "run_tool",
      createEventId: (() => {
        let next = 0;
        return () => `evt_tool_${++next}`;
      })(),
      now: () => "2026-05-03T01:23:00.000Z"
    });

    const events = await collect(runtime.runTurn({ sessionId: "session_1", message: "Read README." }));

    // Unknown tool: error is fed back to model (no permission evaluation), loop continues,
    // FakeModelProvider is exhausted → error output → run_failed.
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_failed",
      "model_request_started",
      "model_request_completed",
      "run_failed"
    ]);
    expect(events[4]).toMatchObject({
      type: "tool_call_requested",
      call: { id: "call_1", name: "read_file", input: { path: "README.md" } }
    });
    expect(events[5]).toMatchObject({
      type: "tool_failed",
      callId: "call_1",
      toolName: "read_file",
      error: { message: `Tool "read_file" is not registered.` }
    });
  });

  test("uses the configured permission policy for requested tool calls", async () => {
    const evaluatedActions: unknown[] = [];
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [
            {
              id: "call_custom",
              name: "custom_tool",
              input: {
                value: 1
              }
            }
          ]
        }
      ]),
      tools: [
        {
          name: "custom_tool",
          description: "A custom tool.",
          risk: "medium" as const,
          inputSchema: { type: "object" as const, properties: { value: { type: "integer" } } },
          execute: async () => ({ ok: true as const, content: "result", summary: "done" })
        }
      ],
      permissionPolicy: {
        evaluate(input) {
          evaluatedActions.push(input);
          return {
            decision: "deny",
            risk: input.action.risk,
            reason: "Custom policy denied this tool."
          };
        }
      },
      systemInstruction: "You are Vole.",
      runtime: {
        mode: "auto",
        workspace: "/workspace/project",
        currentDate: "2026-05-03"
      },
      createRunId: () => "run_policy",
      createEventId: (() => {
        let next = 0;
        return () => `evt_policy_${++next}`;
      })(),
      now: () => "2026-05-03T01:24:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Use custom tool." }));

    expect(evaluatedActions).toEqual([
      {
        mode: "auto",
        action: {
          kind: "tool",
          name: "custom_tool",
          summary: "Model requested tool custom_tool.",
          risk: "medium"
        }
      }
    ]);
    expect(events[5]).toMatchObject({
      type: "tool_call_permission_evaluated",
      callId: "call_custom",
      toolName: "custom_tool",
      decision: {
        decision: "deny",
        risk: "medium",
        reason: "Custom policy denied this tool."
      }
    });
  });

  test("uses the configured approval resolver for ask-level tool calls", async () => {
    const approvalRequests: unknown[] = [];
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "call_approve", name: "read_file", input: { path: "README.md" } }]
        },
        { type: "message", content: "Read the file successfully." }
      ]),
      tools: [
        {
          name: "read_file",
          description: "Read a file.",
          risk: "medium" as const,
          inputSchema: { type: "object" as const, properties: { path: { type: "string" } } },
          execute: async () => ({ ok: true as const, content: "file content", summary: "Read file." })
        }
      ],
      approvalResolver: {
        resolve(request) {
          approvalRequests.push(request);
          return Promise.resolve({
            approved: true,
            reason: "Approved by test."
          });
        }
      },
      systemInstruction: "You are Vole.",
      createRunId: () => "run_approval",
      createEventId: (() => {
        let next = 0;
        return () => `evt_approval_${++next}`;
      })(),
      now: () => "2026-05-03T01:25:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Read README." }));

    expect(approvalRequests).toEqual([
      {
        call: {
          id: "call_approve",
          name: "read_file",
          input: { path: "README.md" }
        },
        decision: {
          decision: "ask",
          risk: "medium",
          reason: "Medium and high-risk actions require approval in confirm mode."
        }
      }
    ]);
    // Approved tool executes, result is fed back, model returns a final message.
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
      "approval_requested",
      "approval_resolved",
      "tool_started",
      "tool_completed",
      "model_request_started",
      "model_request_completed",
      "assistant_message_created",
      "run_completed"
    ]);
    expect(events[7]).toMatchObject({
      type: "approval_resolved",
      callId: "call_approve",
      toolName: "read_file",
      resolution: { approved: true, reason: "Approved by test." }
    });
    expect(events[8]).toMatchObject({ type: "tool_started", callId: "call_approve" });
    expect(events[9]).toMatchObject({ type: "tool_completed", callId: "call_approve" });
  });

  test("executes an allowed tool call and sends the observation back to the model", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-core-tools-"));
    await writeFile(join(workspace, "README.md"), "Tool observation content.");
    const modelProvider = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [
          {
            id: "call_read",
            name: "read_file",
            input: {
              path: "README.md"
            }
          }
        ]
      },
      {
        type: "message",
        content: "I read the file."
      }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [createReadFileTool()],
      systemInstruction: "You are Vole.",
      runtime: {
        mode: "confirm",
        workspace,
        currentDate: "2026-05-03"
      },
      createRunId: () => "run_execute_tool",
      createEventId: (() => {
        let next = 0;
        return () => `evt_execute_tool_${++next}`;
      })(),
      now: () => "2026-05-03T01:26:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Read README." }));

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
      "tool_started",
      "tool_completed",
      "model_request_started",
      "model_request_completed",
      "assistant_message_created",
      "run_completed"
    ]);
    expect(events[5]).toMatchObject({
      type: "tool_call_permission_evaluated",
      decision: {
        decision: "allow",
        risk: "low"
      }
    });
    expect(events[6]).toMatchObject({
      type: "tool_started",
      callId: "call_read",
      toolName: "read_file"
    });
    expect(events[7]).toMatchObject({
      type: "tool_completed",
      callId: "call_read",
      toolName: "read_file",
      result: {
        ok: true,
        summary: "Read file README.md."
      }
    });
    expect(modelProvider.requests).toHaveLength(2);
    // Second request includes: original messages + assistant tool_calls message + tool result message
    expect(modelProvider.requests[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call_read", name: "read_file" }]
    });
    expect(modelProvider.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_read",
      content: JSON.stringify({
        ok: true,
        content: "Tool observation content.",
        summary: "Read file README.md."
      })
    });
    expect(events[10]).toMatchObject({
      type: "assistant_message_created",
      message: {
        content: "I read the file."
      }
    });
  });

  test("passes registered tool definitions to the model provider", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-core-tools-"));
    await writeFile(join(workspace, "README.md"), "Hello.");
    const modelProvider = new FakeModelProvider([{ type: "message", content: "Done." }]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [createReadFileTool()],
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace, currentDate: "2026-05-03" },
      createRunId: () => "run_tool_defs",
      createEventId: (() => { let n = 0; return () => `evt_td_${++n}`; })(),
      now: () => "2026-05-03T01:27:00.000Z"
    });

    await collect(runtime.runTurn({ message: "Hello." }));

    expect(modelProvider.requests[0]?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "read_file" }) })])
    );
  });

  test("loops for multiple tool-calling rounds until model returns a message", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-core-tools-"));
    await writeFile(join(workspace, "a.txt"), "first");
    await writeFile(join(workspace, "b.txt"), "second");
    const modelProvider = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [{ id: "call_a", name: "read_file", input: { path: "a.txt" } }]
      },
      {
        type: "tool_calls",
        calls: [{ id: "call_b", name: "read_file", input: { path: "b.txt" } }]
      },
      { type: "message", content: "Read both files." }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [createReadFileTool()],
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace, currentDate: "2026-05-03" },
      createRunId: () => "run_multi",
      createEventId: (() => { let n = 0; return () => `evt_multi_${++n}`; })(),
      now: () => "2026-05-03T01:28:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Read both files." }));

    expect(modelProvider.requests).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_started")).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool_completed")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("run_completed");
    expect(events.find((e) => e.type === "assistant_message_created")).toMatchObject({
      type: "assistant_message_created",
      message: { content: "Read both files." }
    });
  });

  test("feeds unknown tool error back to model as a tool result", async () => {
    const modelProvider = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [{ id: "call_unknown", name: "nonexistent_tool", input: {} }]
      },
      { type: "message", content: "I could not find that tool." }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      systemInstruction: "You are Vole.",
      createRunId: () => "run_unknown_tool",
      createEventId: (() => { let n = 0; return () => `evt_ut_${++n}`; })(),
      now: () => "2026-05-03T01:30:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Use a fake tool." }));

    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_failed",
      "model_request_started",
      "model_request_completed",
      "assistant_message_created",
      "run_completed"
    ]);
    expect(events[5]).toMatchObject({
      type: "tool_failed",
      callId: "call_unknown",
      toolName: "nonexistent_tool",
      error: { message: `Tool "nonexistent_tool" is not registered.` }
    });
    // Error message fed to model as tool_result in the second request.
    expect(modelProvider.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call_unknown",
      content: expect.stringContaining("not registered")
    });
  });

  test("feeds tool execution exception back to model as a tool result", async () => {
    const throwingTool = {
      name: "crash_tool",
      description: "A tool that always throws.",
      risk: "low" as const,
      inputSchema: { type: "object" as const, properties: {} },
      execute: async () => { throw new Error("Simulated tool crash."); }
    };
    const modelProvider = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [{ id: "call_crash", name: "crash_tool", input: {} }]
      },
      { type: "message", content: "The tool crashed." }
    ]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [throwingTool],
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace: "/workspace", currentDate: "2026-05-03" },
      createRunId: () => "run_tool_crash",
      createEventId: (() => { let n = 0; return () => `evt_tc_${++n}`; })(),
      now: () => "2026-05-03T01:31:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Use the crashing tool." }));

    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
      "tool_started",
      "tool_failed",
      "model_request_started",
      "model_request_completed",
      "assistant_message_created",
      "run_completed"
    ]);
    expect(events[7]).toMatchObject({
      type: "tool_failed",
      callId: "call_crash",
      error: { message: "Simulated tool crash." }
    });
    expect(modelProvider.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call_crash",
      content: "Error: Simulated tool crash."
    });
  });

  test("stops with run_failed when maxSteps is exceeded", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-core-tools-"));
    await writeFile(join(workspace, "file.txt"), "content");
    // Provide infinite tool_calls outputs by giving more than maxSteps
    const modelProvider = new FakeModelProvider(
      Array.from({ length: 5 }, (_, i) => ({
        type: "tool_calls" as const,
        calls: [{ id: `call_${i}`, name: "read_file", input: { path: "file.txt" } }]
      }))
    );
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [createReadFileTool()],
      maxSteps: 2,
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace, currentDate: "2026-05-03" },
      createRunId: () => "run_limit",
      createEventId: (() => { let n = 0; return () => `evt_limit_${++n}`; })(),
      now: () => "2026-05-03T01:29:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Loop forever." }));

    expect(events.at(-1)).toMatchObject({
      type: "run_failed",
      error: { message: expect.stringContaining("step limit") }
    });
    expect(modelProvider.requests).toHaveLength(2);
  });
});


describe("planning stall detection", () => {
  function makeRuntime(outputs: import("@vole/models").ModelOutput[], overrides: Partial<import("./index.js").AgentRuntimeDependencies> = {}) {
    return new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider(outputs),
      systemInstruction: "You are Vole.",
      tools: [createReadFileTool()],
      createRunId: () => "run_stall",
      createEventId: (() => { let n = 0; return () => `evt_st_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z",
      ...overrides
    });
  }

  test("emits planning_stall_detected when model narrates a plan without tool calls", async () => {
    const runtime = makeRuntime([
      { type: "message", content: "I'll start by reading the file, then summarize it." },
      { type: "message", content: "Done." }
    ]);
    const events = await collect(runtime.runTurn({ message: "Summarize the project." }));
    const types = events.map((e) => e.type);
    expect(types).toContain("planning_stall_detected");
    expect(types).toContain("run_completed");
  });

  test("emits run_failed after maxPlanningStallRetries consecutive stalls", async () => {
    const runtime = makeRuntime(
      [
        { type: "message", content: "I'll read the file first." },
        { type: "message", content: "Let me investigate the contents next." },
      ],
      { maxPlanningStallRetries: 2 }
    );
    const events = await collect(runtime.runTurn({ message: "Do the task." }));
    expect(events.at(-1)).toMatchObject({
      type: "run_failed",
      error: { message: expect.stringContaining("plan-only turns") }
    });
    expect(events.filter((e) => e.type === "planning_stall_detected")).toHaveLength(2);
  });

  test("does not detect stall when model calls a tool", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-stall-"));
    try {
      await writeFile(join(workspace, "README.md"), "hello");
      const runtime = new AgentRuntime({
        contextAssembler: new DefaultContextAssembler(),
        modelProvider: new FakeModelProvider([
          { type: "tool_calls", calls: [{ id: "tc1", name: "read_file", input: { path: "README.md" } }] },
          { type: "message", content: "Summary: hello." }
        ]),
        systemInstruction: "You are Vole.",
        tools: [createReadFileTool()],
        runtime: { mode: "auto", workspace, currentDate: "2026-05-04" },
        createRunId: () => "run_no_stall",
        createEventId: (() => { let n = 0; return () => `evt_ns_${++n}`; })(),
        now: () => "2026-05-04T10:00:00.000Z"
      });
      const events = await collect(runtime.runTurn({ message: "Read and summarize." }));
      expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
      expect(events.at(-1)?.type).toBe("run_completed");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("does not detect stall when no tools are registered", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        { type: "message", content: "I'll think about this step by step." }
      ]),
      systemInstruction: "You are Vole.",
      createRunId: () => "run_no_tool",
      createEventId: (() => { let n = 0; return () => `evt_nt_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Think." }));
    expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  test("does not detect stall after a real tool call even when message looks like a plan (hadRealToolCallThisTurn)", async () => {
    // OpenClaw alignment: hasNonPlanToolActivity — if the model already did real work
    // this turn, a subsequent message that uses planning-like language is reporting
    // results, not stalling. Without this guard, a structured summary response
    // (e.g. "I'll summarize:\n1. X\n2. Y") after read_file triggers a false stall.
    const workspace = await mkdtemp(join(tmpdir(), "vole-stall-"));
    try {
      await writeFile(join(workspace, "README.md"), "hello");
      const planLikeMessages = [
        // Structured plan format (bullets + promise) — would be a stall without the guard
        "I'll now summarize:\n1. The file says hello.\n2. That's all.",
        // Promise + action verb — would be a stall without the guard
        "Let me analyze what I read: the content is hello.",
        // Plain reporting — already passes without the guard
        "The file contains: hello.",
      ];
      for (const msg of planLikeMessages) {
        const runtime = new AgentRuntime({
          contextAssembler: new DefaultContextAssembler(),
          modelProvider: new FakeModelProvider([
            { type: "tool_calls", calls: [{ id: "tc1", name: "read_file", input: { path: "README.md" } }] },
            { type: "message", content: msg }
          ]),
          systemInstruction: "You are Vole.",
          tools: [createReadFileTool()],
          runtime: { mode: "auto", workspace, currentDate: "2026-05-04" },
          createRunId: () => "run_post_tool",
          createEventId: (() => { let n = 0; return () => `evt_pt_${++n}`; })(),
          now: () => "2026-05-04T10:00:00.000Z"
        });
        const events = await collect(runtime.runTurn({ message: "Read and summarize." }));
        expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
        expect(events.at(-1)?.type).toBe("run_completed");
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("still detects stall on first message when no tool has been called yet", async () => {
    // hadRealToolCallThisTurn must not affect the stall check before any tool call.
    const runtime = makeRuntime([
      { type: "message", content: "I'll read the file and then summarize it." },
      { type: "message", content: "Done." }
    ]);
    const events = await collect(runtime.runTurn({ message: "Summarize the project." }));
    expect(events.map((e) => e.type)).toContain("planning_stall_detected");
  });

  test("only update_todos calls do not set hadRealToolCallThisTurn", async () => {
    // update_todos is a meta-tool (tracking, not work). Calling it alone must
    // not suppress stall detection on a subsequent planning-only message.
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        { type: "tool_calls", calls: [{ id: "tc1", name: "update_todos", input: { todos: [] } }] },
        { type: "message", content: "I'll read the file and summarize it." },
        { type: "message", content: "Done." }
      ]),
      systemInstruction: "You are Vole.",
      tools: [createReadFileTool()],
      createRunId: () => "run_todos_only",
      createEventId: (() => { let n = 0; return () => `evt_to_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Do the task." }));
    expect(events.map((e) => e.type)).toContain("planning_stall_detected");
  });

  test("does not detect stall for bullet lists without promise language", async () => {
    // Bullets alone (no promise phrase) must never trigger the stall detector.
    const bulletContents = [
      "Directory listing:\n1. src/\n2. dist/\n3. node_modules/",
      "The project contains:\n- packages/ (12 packages)\n- apps/ (2 apps)",
    ];
    for (const content of bulletContents) {
      const runtime = makeRuntime([{ type: "message", content }]);
      const events = await collect(runtime.runTurn({ message: "List the files." }));
      expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
      expect(events.at(-1)?.type).toBe("run_completed");
    }
  });

  test("does not detect stall when completion language is present (COMPLETION_RE guard)", async () => {
    // Completion words (found, done, implemented…) signal the model already acted.
    // Even if promise + action verb are also present, completion takes priority.
    const completionContents = [
      "I found the following files:\n- package.json\n- README.md",
      "I'll show you what I found: version 1.0.0",      // promise + verb BUT "found"
      "Done.",
      "I've implemented the fix and verified it passes.",  // "implemented" + "verified"
      "I ran the tests and they all passed.",             // "ran"
    ];
    for (const content of completionContents) {
      const runtime = makeRuntime([{ type: "message", content }]);
      const events = await collect(runtime.runTurn({ message: "Do the task." }));
      expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
      expect(events.at(-1)?.type).toBe("run_completed");
    }
  });

  test("does not detect stall when response is longer than 700 characters (length guard)", async () => {
    // Long responses are almost certainly result reports, not plans.
    const longContent = "I'll analyze the results. " + "x ".repeat(350);
    const runtime = makeRuntime([{ type: "message", content: longContent }]);
    const events = await collect(runtime.runTurn({ message: "Analyze." }));
    expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  test("does not detect stall when response contains a code block (code block guard)", async () => {
    const codeContent = "I'll write this function:\n```typescript\nfunction hello() { return 'hi'; }\n```";
    const runtime = makeRuntime([{ type: "message", content: codeContent }]);
    const events = await collect(runtime.runTurn({ message: "Write a function." }));
    expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  test("does not detect stall for vague filler phrases without action verbs", async () => {
    // "let me think" / "I'll consider" — promise without a concrete action verb.
    const fillerContents = [
      "Let me think about this.",
      "Let me consider the options carefully.",
      "I'll reflect on the best approach.",
    ];
    for (const content of fillerContents) {
      const runtime = makeRuntime([{ type: "message", content }]);
      const events = await collect(runtime.runTurn({ message: "Help me decide." }));
      expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
      expect(events.at(-1)?.type).toBe("run_completed");
    }
  });

  test("detects stall for structured plan (heading + bullets + promise) even without action verb", async () => {
    // Structured format is its own stall signal — action verbs are only required
    // for unstructured promise-only messages.
    const structuredPlan = "Steps:\n- First, I'll get started.\n- Then proceed.";
    const runtime = makeRuntime([
      { type: "message", content: structuredPlan },
      { type: "message", content: "Done." }
    ]);
    const events = await collect(runtime.runTurn({ message: "Do the task." }));
    expect(events.map((e) => e.type)).toContain("planning_stall_detected");
  });
});

describe("todos_updated event", () => {
  test("emits todos_updated when model calls update_todos", async () => {
    const workspace = tmpdir();
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "tc1", name: "update_todos", input: { todos: [{ content: "Step 1", status: "in_progress" }] } }]
        },
        { type: "message", content: "Done." }
      ]),
      systemInstruction: "You are Vole.",
      runtime: { mode: "auto", workspace, currentDate: "2026-05-04" },
      createRunId: () => "run_todos",
      createEventId: (() => { let n = 0; return () => `evt_td_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Track progress." }));
    const todosEvent = events.find((e) => e.type === "todos_updated");
    expect(todosEvent).toBeDefined();
    expect(todosEvent).toMatchObject({
      type: "todos_updated",
      todos: [{ content: "Step 1", status: "in_progress" }]
    });
  });

  test("does not emit todos_updated when update_todos was not called", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([{ type: "message", content: "Done." }]),
      systemInstruction: "You are Vole.",
      createRunId: () => "run_no_todos",
      createEventId: (() => { let n = 0; return () => `evt_no_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Hello." }));
    expect(events.map((e) => e.type)).not.toContain("todos_updated");
  });
});

describe("streaming path", () => {
  test("emits token_delta events when preferStreaming is true and provider supports streaming", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeStreamingProvider([["Hello", " ", "world"]]),
      systemInstruction: "You are Vole.",
      preferStreaming: true,
      createRunId: () => "run_stream",
      createEventId: (() => { let n = 0; return () => `evt_s_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Hi." }));
    const tokenDeltas = events.filter((e) => e.type === "token_delta");

    expect(tokenDeltas).toHaveLength(3);
    expect(tokenDeltas[0]).toMatchObject({ type: "token_delta", delta: "Hello" });
    expect(tokenDeltas[2]).toMatchObject({ type: "token_delta", delta: "world" });

    const messageEvent = events.find((e) => e.type === "assistant_message_created");
    expect(messageEvent).toMatchObject({ type: "assistant_message_created", message: { content: "Hello world" } });
  });

  test("does not emit token_delta when preferStreaming is false (default)", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeStreamingProvider([["Hello", " ", "world"]]),
      systemInstruction: "You are Vole.",
      createRunId: () => "run_nostream",
      createEventId: (() => { let n = 0; return () => `evt_ns_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Hi." }));
    expect(events.map((e) => e.type)).not.toContain("token_delta");
  });
});

describe("createSpawnSubagentTool", () => {
  test("returns ok:true with sub-agent result text when sub-agent completes successfully", async () => {
    const subProvider = new FakeModelProvider([{ type: "message", content: "Sub-agent result." }]);
    const factory: SubagentFactory = {
      create: (_goal) =>
        new AgentRuntime({
          contextAssembler: new DefaultContextAssembler(),
          modelProvider: subProvider,
          systemInstruction: "You are a sub-agent.",
          createRunId: () => "sub_run_1",
          createEventId: (() => { let n = 0; return () => `sub_evt_${++n}`; })(),
          now: () => "2026-05-05T10:00:00.000Z"
        })
    };

    const tool = createSpawnSubagentTool(factory);
    const result = await tool.execute({ goal: "Do a subtask." }, { workspaceRoot: "/workspace" });

    expect(result).toEqual({ type: "spawn_subagent_result", ok: true, result: "Sub-agent result." });
  });

  test("returns ok:false with error message when sub-agent run fails", async () => {
    const subProvider = new FakeModelProvider([
      {
        type: "error",
        category: "network",
        message: "Sub-agent network error.",
        recoverable: false
      }
    ]);
    const factory: SubagentFactory = {
      create: (_goal) =>
        new AgentRuntime({
          contextAssembler: new DefaultContextAssembler(),
          modelProvider: subProvider,
          systemInstruction: "You are a sub-agent.",
          createRunId: () => "sub_run_fail",
          createEventId: (() => { let n = 0; return () => `sub_evt_fail_${++n}`; })(),
          now: () => "2026-05-05T10:00:00.000Z"
        })
    };

    const tool = createSpawnSubagentTool(factory);
    const result = await tool.execute({ goal: "Do a failing subtask." }, { workspaceRoot: "/workspace" });

    expect(result).toEqual({ type: "spawn_subagent_result", ok: false, error: "Sub-agent network error." });
  });
});

describe("AgentHooks", () => {
  function makeHooksRuntime(hooks: AgentHooks, outputs: import("@vole/models").ModelOutput[]) {
    return new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider(outputs),
      systemInstruction: "You are Vole.",
      hooks,
      createRunId: () => "run_hooks",
      createEventId: (() => { let n = 0; return () => `evt_h_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });
  }

  test("beforeTurn is called before run_started", async () => {
    const order: string[] = [];
    const hooks: AgentHooks = {
      beforeTurn: async () => { order.push("beforeTurn"); }
    };
    const runtime = makeHooksRuntime(hooks, [{ type: "message", content: "Done." }]);
    const events: string[] = [];
    for await (const event of runtime.runTurn({ message: "Hi." })) {
      events.push(event.type);
      order.push(event.type);
    }
    // beforeTurn must appear before run_started
    expect(order.indexOf("beforeTurn")).toBeLessThan(order.indexOf("run_started"));
  });

  test("afterTurn receives all events including run_completed", async () => {
    let receivedEvents: RuntimeEvent[] = [];
    const hooks: AgentHooks = {
      afterTurn: async (events) => { receivedEvents = events; }
    };
    const runtime = makeHooksRuntime(hooks, [{ type: "message", content: "Done." }]);
    await collect(runtime.runTurn({ message: "Hi." }));
    expect(receivedEvents.map((e) => e.type)).toContain("run_completed");
    expect(receivedEvents.length).toBeGreaterThan(0);
  });

  test("beforeToolCall returning 'abort' yields tool_failed and skips execution", async () => {
    const executedTools: string[] = [];
    const hooks: AgentHooks = {
      beforeToolCall: async () => "abort"
    };
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "call_abort", name: "noop_tool", input: {} }]
        },
        { type: "message", content: "Aborted." }
      ]),
      tools: [
        {
          name: "noop_tool",
          description: "A no-op tool.",
          risk: "low" as const,
          inputSchema: { type: "object" as const, properties: {} },
          execute: async () => {
            executedTools.push("noop_tool");
            return { ok: true as const, content: "noop", summary: "noop" };
          }
        }
      ],
      systemInstruction: "You are Vole.",
      hooks,
      runtime: { mode: "auto", workspace: "/workspace", currentDate: "2026-05-05" },
      createRunId: () => "run_abort",
      createEventId: (() => { let n = 0; return () => `evt_ab_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Run tool." }));

    // Tool was NOT executed
    expect(executedTools).toHaveLength(0);
    // tool_failed was emitted
    expect(events.map((e) => e.type)).toContain("tool_failed");
    expect(events.find((e) => e.type === "tool_failed")).toMatchObject({
      type: "tool_failed",
      error: { message: "Tool call aborted by hook." }
    });
  });

  test("hook throwing does not fail the run (run_completed still emitted)", async () => {
    const hooks: AgentHooks = {
      beforeTurn: async () => { throw new Error("beforeTurn exploded"); },
      afterTurn: async () => { throw new Error("afterTurn exploded"); }
    };
    const runtime = makeHooksRuntime(hooks, [{ type: "message", content: "Done." }]);
    const events = await collect(runtime.runTurn({ message: "Hi." }));
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  test("afterToolCall is called after tool_completed", async () => {
    const afterCalls: string[] = [];
    const hooks: AgentHooks = {
      afterToolCall: async (call) => { afterCalls.push(call.name); }
    };
    const workspace = await import("node:os").then((os) => os.tmpdir());
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "call_after", name: "noop_tool2", input: {} }]
        },
        { type: "message", content: "Done." }
      ]),
      tools: [
        {
          name: "noop_tool2",
          description: "A no-op tool.",
          risk: "low" as const,
          inputSchema: { type: "object" as const, properties: {} },
          execute: async () => ({ ok: true as const, content: "noop2", summary: "noop2" })
        }
      ],
      systemInstruction: "You are Vole.",
      hooks,
      runtime: { mode: "auto", workspace, currentDate: "2026-05-05" },
      createRunId: () => "run_after",
      createEventId: (() => { let n = 0; return () => `evt_at_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Run tool." }));
    expect(afterCalls).toEqual(["noop_tool2"]);
    expect(events.map((e) => e.type)).toContain("tool_completed");
  });
});

describe("compaction_triggered event", () => {
  test("emits compaction_triggered when message count exceeds maxMessages", async () => {
    // Build enough recentMessages to push total over the compaction threshold.
    // Default maxMessages=30, keepRecent=12. With a system message + 29 history
    // messages + 1 user message = 31 total → compaction fires.
    const recentMessages: import("@vole/models").ModelMessage[] = Array.from({ length: 29 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`
    }));

    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        { type: "message", content: "Summarised." },   // compaction call
        { type: "message", content: "Done." }           // main turn response
      ]),
      systemInstruction: "You are Vole.",
      compaction: { maxMessages: 30, keepRecent: 12, summarySystemPrompt: "Distil." },
      createRunId: () => "run_compact",
      createEventId: (() => { let n = 0; return () => `evt_c_${++n}`; })(),
      now: () => "2026-05-07T00:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ sessionId: "s1", message: "Go.", recentMessages }));
    const types = events.map((e) => e.type);

    expect(types).toContain("compaction_triggered");

    const compactionEvent = events.find((e) => e.type === "compaction_triggered") as import("./index.js").CompactionTriggeredEvent;
    expect(compactionEvent).toBeDefined();
    expect(compactionEvent.messagesBefore).toBeGreaterThan(compactionEvent.messagesAfter);
  });

  test("does not emit compaction_triggered when message count is within limit", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([{ type: "message", content: "Done." }]),
      systemInstruction: "You are Vole.",
      compaction: { maxMessages: 30, keepRecent: 12, summarySystemPrompt: "Distil." },
      createRunId: () => "run_no_compact",
      createEventId: (() => { let n = 0; return () => `evt_nc_${++n}`; })(),
      now: () => "2026-05-07T00:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ sessionId: "s1", message: "Hi." }));
    expect(events.map((e) => e.type)).not.toContain("compaction_triggered");
  });
});

describe("strict-agentic execution contract", () => {
  test("strict-agentic uses maxRetries 3 by default", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        { type: "message", content: "I'll read the file first." },
        { type: "message", content: "Let me investigate the project structure." },
        { type: "message", content: "I will now search for the answer." },
        { type: "message", content: "Done." }
      ]),
      systemInstruction: "You are Vole.",
      tools: [createReadFileTool()],
      executionContract: "strict-agentic",
      createRunId: () => "run_strict",
      createEventId: (() => { let n = 0; return () => `evt_strict_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Do the task." }));
    const stallEvents = events.filter((e) => e.type === "planning_stall_detected");
    // With strict-agentic, maxRetries is 3, so 3 stalls before failure
    expect(stallEvents).toHaveLength(3);
    if (stallEvents[0]) {
      expect((stallEvents[0] as import("./index.js").PlanningStallDetectedEvent).maxRetries).toBe(3);
    }
    expect(events.at(-1)?.type).toBe("run_failed");
  });

  test("default contract uses maxRetries 2", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([
        { type: "message", content: "I'll read the file first." },
        { type: "message", content: "Let me investigate the contents." },
        { type: "message", content: "Done." }
      ]),
      systemInstruction: "You are Vole.",
      tools: [createReadFileTool()],
      createRunId: () => "run_default",
      createEventId: (() => { let n = 0; return () => `evt_def_${++n}`; })(),
      now: () => "2026-05-05T10:00:00.000Z"
    });

    const events = await collect(runtime.runTurn({ message: "Do the task." }));
    const stallEvents = events.filter((e) => e.type === "planning_stall_detected");
    expect(stallEvents).toHaveLength(2);
    if (stallEvents[0]) {
      expect((stallEvents[0] as import("./index.js").PlanningStallDetectedEvent).maxRetries).toBe(2);
    }
    expect(events.at(-1)?.type).toBe("run_failed");
  });
});

describe("SessionMutex", () => {
  test("single acquire + release resolves immediately", async () => {
    const mutex = new SessionMutex();
    const release = await mutex.acquire("session-1");
    expect(typeof release).toBe("function");
    release();
  });

  test("two concurrent acquires for same session: second waits for first to release", async () => {
    const mutex = new SessionMutex();
    const order: number[] = [];

    const release1 = await mutex.acquire("session-A");
    order.push(1);

    let release2: (() => void) | undefined;
    const p2 = mutex.acquire("session-A").then((rel) => {
      order.push(2);
      release2 = rel;
    });

    // Give p2 a chance to run — it should NOT proceed yet
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([1]);

    // Now release the first lock
    release1();
    await p2;
    expect(order).toEqual([1, 2]);
    release2?.();
  });

  test("different sessions: both acquire without waiting", async () => {
    const mutex = new SessionMutex();
    const order: string[] = [];

    const [rel1, rel2] = await Promise.all([
      mutex.acquire("session-X").then((rel) => { order.push("X"); return rel; }),
      mutex.acquire("session-Y").then((rel) => { order.push("Y"); return rel; })
    ]);

    expect(order).toHaveLength(2);
    expect(order).toContain("X");
    expect(order).toContain("Y");
    rel1();
    rel2();
  });
});

describe("createSpawnSubagentAsyncTool", () => {
  test("spawn_subagent_async returns taskId immediately without waiting", async () => {
    let subagentStarted = false;
    let subagentResolved = false;

    // Sub-agent that takes a tick to complete
    const factory: SubagentFactory = {
      create: (_goal) =>
        new AgentRuntime({
          contextAssembler: new DefaultContextAssembler(),
          modelProvider: new FakeModelProvider([{ type: "message", content: "Async sub-agent done." }]),
          systemInstruction: "You are a sub-agent.",
          createRunId: () => "sub_async_run",
          createEventId: (() => { let n = 0; return () => `sub_async_evt_${++n}`; })(),
          now: () => "2026-05-05T10:00:00.000Z",
          hooks: {
            beforeTurn: async () => { subagentStarted = true; },
            afterTurn: async () => { subagentResolved = true; }
          }
        })
    };

    const createdRecords: Array<{ id: string; runtime: string; task: string; status: string }> = [];
    const taskStore: AsyncTaskStore = {
      async create(record) {
        createdRecords.push(record);
        return { id: record.id };
      }
    };

    const tool = createSpawnSubagentAsyncTool(factory, { taskStore });
    const result = await tool.execute({ goal: "Run async subtask." }, { workspaceRoot: "/workspace" });

    // Returns immediately with a taskId
    expect(result).toMatchObject({ type: "spawn_subagent_async_result", status: "queued" });
    expect((result as unknown as { taskId: string }).taskId).toMatch(/^task_/);

    // Task store was called
    expect(createdRecords).toHaveLength(1);
    expect(createdRecords[0]).toMatchObject({
      runtime: "subagent",
      task: "Run async subtask.",
      status: "queued"
    });

    // Wait for background execution to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subagentStarted).toBe(true);
    expect(subagentResolved).toBe(true);
  });
});

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

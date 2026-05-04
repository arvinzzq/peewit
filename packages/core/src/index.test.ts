import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { FakeModelProvider } from "@arvinclaw/models";
import { createReadFileTool } from "@arvinclaw/tools";
import {
  AgentRuntime,
  InMemoryRuntimeTraceStore,
  createRuntimeEvent,
  isTerminalRuntimeEvent,
  runtimeEventTypes,
  type RuntimeEvent
} from "./index.js";

describe("runtime event contracts", () => {
  test("declares the runtime event vocabulary", () => {
    expect(runtimeEventTypes).toEqual([
      "run_started",
      "context_assembled",
      "todos_updated",
      "planning_stall_detected",
      "model_request_started",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-core-tools-"));
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
      systemInstruction: "You are ArvinClaw.",
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-core-tools-"));
    await writeFile(join(workspace, "README.md"), "Hello.");
    const modelProvider = new FakeModelProvider([{ type: "message", content: "Done." }]);
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider,
      tools: [createReadFileTool()],
      systemInstruction: "You are ArvinClaw.",
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-core-tools-"));
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-core-tools-"));
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
      systemInstruction: "You are ArvinClaw.",
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
  function makeRuntime(outputs: import("@arvinclaw/models").ModelOutput[], overrides: Partial<import("./index.js").AgentRuntimeDependencies> = {}) {
    return new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider(outputs),
      systemInstruction: "You are ArvinClaw.",
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
        { type: "message", content: "Let me proceed step by step." },
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-stall-"));
    try {
      await writeFile(join(workspace, "README.md"), "hello");
      const runtime = new AgentRuntime({
        contextAssembler: new DefaultContextAssembler(),
        modelProvider: new FakeModelProvider([
          { type: "tool_calls", calls: [{ id: "tc1", name: "read_file", input: { path: "README.md" } }] },
          { type: "message", content: "Summary: hello." }
        ]),
        systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
      createRunId: () => "run_no_tool",
      createEventId: (() => { let n = 0; return () => `evt_nt_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Think." }));
    expect(events.map((e) => e.type)).not.toContain("planning_stall_detected");
    expect(events.at(-1)?.type).toBe("run_completed");
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
      createRunId: () => "run_no_todos",
      createEventId: (() => { let n = 0; return () => `evt_no_${++n}`; })(),
      now: () => "2026-05-04T10:00:00.000Z"
    });
    const events = await collect(runtime.runTurn({ message: "Hello." }));
    expect(events.map((e) => e.type)).not.toContain("todos_updated");
  });
});

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

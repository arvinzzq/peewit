import { describe, expect, test } from "vitest";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { FakeModelProvider } from "@arvinclaw/models";
import {
  AgentRuntime,
  InMemoryRuntimeTraceStore,
  createRuntimeEvent,
  isTerminalRuntimeEvent,
  runtimeEventTypes,
  type RuntimeEvent
} from "./index.js";

describe("runtime event contracts", () => {
  test("declares the Phase 1 message-only event vocabulary", () => {
    expect(runtimeEventTypes).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
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

    expect(modelProvider.requests[0]?.messages).toEqual([
      {
        role: "system",
        content: "You are ArvinClaw."
      },
      {
        role: "user",
        content: "Remember this detail."
      },
      {
        role: "assistant",
        content: "I will use it in the next turn."
      },
      {
        role: "user",
        content: "Continue."
      }
    ]);
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

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "context_assembled",
      "model_request_started",
      "model_request_completed",
      "tool_call_requested",
      "tool_call_permission_evaluated",
      "run_failed"
    ]);
    expect(events[4]).toMatchObject({
      type: "tool_call_requested",
      call: {
        id: "call_1",
        name: "read_file",
        input: {
          path: "README.md"
        }
      }
    });
    expect(events[5]).toMatchObject({
      type: "tool_call_permission_evaluated",
      callId: "call_1",
      toolName: "read_file",
      decision: {
        decision: "ask",
        risk: "medium",
        reason: "Medium and high-risk actions require approval in confirm mode."
      }
    });
    expect(events[6]).toMatchObject({
      type: "run_failed",
      error: {
        message: "Tool execution is not wired yet.",
        recoverable: false
      }
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
});

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

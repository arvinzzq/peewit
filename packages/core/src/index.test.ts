import { describe, expect, test } from "vitest";
import { DefaultContextAssembler } from "@arvinclaw/context";
import { FakeModelProvider } from "@arvinclaw/models";
import {
  AgentRuntime,
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
});

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

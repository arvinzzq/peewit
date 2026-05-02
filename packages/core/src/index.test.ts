import { describe, expect, test } from "vitest";
import {
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

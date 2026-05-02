import { describe, expect, test } from "vitest";
import {
  FakeModelProvider,
  type ModelInput,
  type ModelOutput,
  type ModelProvider
} from "./index.js";

describe("model provider contract", () => {
  test("fake provider returns queued assistant messages", async () => {
    const provider: ModelProvider = new FakeModelProvider([
      {
        type: "message",
        content: "Hello from the fake model."
      }
    ]);
    const input: ModelInput = {
      messages: [
        { role: "system", content: "You are ArvinClaw." },
        { role: "user", content: "Say hello." }
      ],
      options: {
        model: "fake-model",
        temperature: 0.2,
        maxTokens: 128
      }
    };

    const expected: ModelOutput = {
      type: "message",
      content: "Hello from the fake model."
    };

    await expect(provider.generate(input)).resolves.toEqual(expected);
  });

  test("fake provider records requests for runtime tests", async () => {
    const provider = new FakeModelProvider([
      {
        type: "message",
        content: "Recorded."
      }
    ]);
    const input: ModelInput = {
      messages: [{ role: "user", content: "Record this." }]
    };

    await provider.generate(input);

    expect(provider.requests).toEqual([input]);
  });

  test("fake provider can simulate normalized provider failures", async () => {
    const provider = new FakeModelProvider([
      {
        type: "error",
        category: "network",
        message: "Network unavailable.",
        recoverable: true
      }
    ]);

    const expected: ModelOutput = {
      type: "error",
      category: "network",
      message: "Network unavailable.",
      recoverable: true
    };

    await expect(provider.generate({ messages: [] })).resolves.toEqual(expected);
  });
});

import { describe, expect, test } from "vitest";
import { InMemorySessionStore, type SessionStore } from "./index.js";

describe("in-memory session store", () => {
  test("creates a session and appends ordered messages", async () => {
    const store: SessionStore = new InMemorySessionStore({
      createSessionId: () => "sess_1",
      createMessageId: (() => {
        let index = 0;
        return () => `msg_${++index}`;
      })(),
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-05-03T00:00:00.000Z",
          "2026-05-03T00:00:01.000Z",
          "2026-05-03T00:00:02.000Z"
        ];

        return () => timestamps[index++] ?? "2026-05-03T00:00:03.000Z";
      })()
    });

    const session = await store.createSession({ title: "Learning session" });

    await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: "What is short-term memory?"
    });
    await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "It is recent conversation context."
    });

    await expect(store.getSession(session.id)).resolves.toEqual({
      id: "sess_1",
      title: "Learning session",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:02.000Z"
    });
    await expect(store.listMessages(session.id)).resolves.toEqual([
      {
        id: "msg_1",
        sessionId: "sess_1",
        role: "user",
        content: "What is short-term memory?",
        createdAt: "2026-05-03T00:00:01.000Z"
      },
      {
        id: "msg_2",
        sessionId: "sess_1",
        role: "assistant",
        content: "It is recent conversation context.",
        createdAt: "2026-05-03T00:00:02.000Z"
      }
    ]);
  });

  test("returns the most recent messages without exposing internal arrays", async () => {
    const store = new InMemorySessionStore({
      createSessionId: () => "sess_1",
      createMessageId: (() => {
        let index = 0;
        return () => `msg_${++index}`;
      })(),
      now: () => "2026-05-03T00:00:00.000Z"
    });

    const session = await store.createSession();

    await store.appendMessage({ sessionId: session.id, role: "user", content: "one" });
    await store.appendMessage({ sessionId: session.id, role: "assistant", content: "two" });
    await store.appendMessage({ sessionId: session.id, role: "user", content: "three" });

    const recent = await store.listMessages(session.id, { limit: 2 });
    recent.pop();

    await expect(store.listMessages(session.id, { limit: 2 })).resolves.toEqual([
      expect.objectContaining({ content: "two" }),
      expect.objectContaining({ content: "three" })
    ]);
  });
});

import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemorySessionStore, JsonlSessionStore, type SessionStore } from "./index.js";

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

  test("lists sessions by most recent update first", async () => {
    const store = new InMemorySessionStore({
      createSessionId: (() => {
        let index = 0;
        return () => `sess_${++index}`;
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

    const first = await store.createSession({ title: "First session" });
    const second = await store.createSession({ title: "Second session" });

    await store.appendMessage({ sessionId: first.id, role: "user", content: "recent" });

    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "sess_1", updatedAt: "2026-05-03T00:00:02.000Z" }),
      expect.objectContaining({ id: "sess_2", updatedAt: "2026-05-03T00:00:01.000Z" })
    ]);
    await expect(store.listSessions({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "sess_1" })
    ]);
  });

  test("appends and lists recent trace events without exposing internal arrays", async () => {
    const store = new InMemorySessionStore({
      createSessionId: () => "sess_1",
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-05-03T00:00:00.000Z",
          "2026-05-03T00:00:01.000Z",
          "2026-05-03T00:00:02.000Z",
          "2026-05-03T00:00:03.000Z"
        ];

        return () => timestamps[index++] ?? "2026-05-03T00:00:04.000Z";
      })()
    });

    const session = await store.createSession();

    await store.appendTraceEvent({
      sessionId: session.id,
      event: {
        type: "run_started",
        eventId: "evt_1",
        runId: "run_1",
        timestamp: "2026-05-03T00:00:01.000Z"
      }
    });
    await store.appendTraceEvent({
      sessionId: session.id,
      event: {
        type: "run_completed",
        eventId: "evt_2",
        runId: "run_1",
        timestamp: "2026-05-03T00:00:02.000Z"
      }
    });

    const recent = await store.listTraceEvents(session.id, { limit: 1 });
    recent.pop();

    await expect(store.listTraceEvents(session.id, { limit: 1 })).resolves.toEqual([
      {
        sessionId: "sess_1",
        event: expect.objectContaining({ type: "run_completed" }),
        createdAt: "2026-05-03T00:00:02.000Z"
      }
    ]);
  });
});

describe("jsonl session store", () => {
  test("persists sessions and replays ordered messages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-sessions-"));

    try {
      const store = new JsonlSessionStore({
        directory,
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

      const session = await store.createSession({ title: "Durable session" });

      await store.appendMessage({ sessionId: session.id, role: "user", content: "Persist this." });
      await store.appendMessage({ sessionId: session.id, role: "assistant", content: "Persisted." });

      const replayed = new JsonlSessionStore({ directory });

      await expect(replayed.getSession("sess_1")).resolves.toEqual({
        id: "sess_1",
        title: "Durable session",
        createdAt: "2026-05-03T00:00:00.000Z",
        updatedAt: "2026-05-03T00:00:02.000Z"
      });
      await expect(replayed.listMessages("sess_1")).resolves.toEqual([
        {
          id: "msg_1",
          sessionId: "sess_1",
          role: "user",
          content: "Persist this.",
          createdAt: "2026-05-03T00:00:01.000Z"
        },
        {
          id: "msg_2",
          sessionId: "sess_1",
          role: "assistant",
          content: "Persisted.",
          createdAt: "2026-05-03T00:00:02.000Z"
        }
      ]);

      await expect(readFile(join(directory, "sess_1.jsonl"), "utf8")).resolves.toContain("\"type\":\"message\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects unsafe session ids before writing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-sessions-"));

    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "../escape"
      });

      await expect(store.createSession()).rejects.toThrow("Unsafe session id");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("lists replayed JSONL sessions by most recent update first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-sessions-"));

    try {
      const first = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_one",
        createMessageId: () => "msg_one",
        now: (() => {
          let index = 0;
          const timestamps = [
            "2026-05-03T00:00:00.000Z",
            "2026-05-03T00:00:03.000Z"
          ];

          return () => timestamps[index++] ?? "2026-05-03T00:00:04.000Z";
        })()
      });
      const second = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_two",
        createMessageId: () => "msg_two",
        now: () => "2026-05-03T00:00:01.000Z"
      });

      const firstSession = await first.createSession({ title: "First" });
      await second.createSession({ title: "Second" });
      await first.appendMessage({ sessionId: firstSession.id, role: "user", content: "newest" });

      const replayed = new JsonlSessionStore({ directory });

      await expect(replayed.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: "sess_one", updatedAt: "2026-05-03T00:00:03.000Z" }),
        expect.objectContaining({ id: "sess_two", updatedAt: "2026-05-03T00:00:01.000Z" })
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("persists trace events and replays them in order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arvinclaw-sessions-"));

    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_trace",
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

      const session = await store.createSession({ title: "Trace session" });

      await store.appendTraceEvent({
        sessionId: session.id,
        event: {
          type: "run_started",
          eventId: "evt_1",
          runId: "run_1",
          timestamp: "2026-05-03T00:00:01.000Z"
        }
      });
      await store.appendTraceEvent({
        sessionId: session.id,
        event: {
          type: "run_completed",
          eventId: "evt_2",
          runId: "run_1",
          timestamp: "2026-05-03T00:00:02.000Z"
        }
      });

      const replayed = new JsonlSessionStore({ directory });

      await expect(replayed.listTraceEvents("sess_trace")).resolves.toEqual([
        {
          sessionId: "sess_trace",
          event: expect.objectContaining({ type: "run_started", eventId: "evt_1" }),
          createdAt: "2026-05-03T00:00:01.000Z"
        },
        {
          sessionId: "sess_trace",
          event: expect.objectContaining({ type: "run_completed", eventId: "evt_2" }),
          createdAt: "2026-05-03T00:00:02.000Z"
        }
      ]);
      await expect(readFile(join(directory, "sess_trace.jsonl"), "utf8")).resolves.toContain("\"type\":\"trace\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

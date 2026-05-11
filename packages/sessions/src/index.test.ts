import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireSessionFileLock,
  DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS,
  InMemorySessionStore,
  JsonlSessionStore,
  type SessionStore
} from "./index.js";


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

  test("appendMessage stores optional toolCalls and toolCallId fields", async () => {
    const store = new InMemorySessionStore({
      createSessionId: () => "sess_tools",
      createMessageId: (() => {
        let index = 0;
        return () => `msg_${++index}`;
      })(),
      now: () => "2026-05-07T00:00:00.000Z"
    });

    const session = await store.createSession();

    await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call_1", name: "read_file", input: { path: "README.md" } }]
    });
    await store.appendMessage({
      sessionId: session.id,
      role: "tool",
      content: '{"ok":true}',
      toolCallId: "call_1"
    });

    const messages = await store.listMessages(session.id);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call_1", name: "read_file" }]
    });
    expect(messages[1]).toMatchObject({
      role: "tool",
      content: '{"ok":true}',
      toolCallId: "call_1"
    });
  });

  test("appendCompactBoundary resets messages to summary only", async () => {
    const store = new InMemorySessionStore({
      createSessionId: () => "sess_compact",
      createMessageId: (() => {
        let index = 0;
        return () => `msg_${++index}`;
      })(),
      now: () => "2026-05-07T00:00:00.000Z"
    });

    const session = await store.createSession();
    await store.appendMessage({ sessionId: session.id, role: "user", content: "Hello" });
    await store.appendMessage({ sessionId: session.id, role: "assistant", content: "Hi there!" });

    // Before compaction: 2 messages
    const before = await store.listMessages(session.id);
    expect(before).toHaveLength(2);

    await store.appendCompactBoundary({
      sessionId: session.id,
      summary: "User said hello. Assistant responded.",
      messagesBefore: 2,
      messagesAfter: 1
    });

    // After compaction: only the summary remains
    const after = await store.listMessages(session.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      role: "system",
      content: "User said hello. Assistant responded."
    });
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
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

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
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

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
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

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

  test("persists toolCalls and toolCallId fields in message records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_tool_fields",
        createMessageId: (() => {
          let index = 0;
          return () => `msg_${++index}`;
        })(),
        now: () => "2026-05-07T00:00:00.000Z"
      });

      const session = await store.createSession();

      await store.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: null,
        toolCalls: [{ id: "tc_1", name: "read_file", input: { path: "README.md" } }]
      });
      await store.appendMessage({
        sessionId: session.id,
        role: "tool",
        content: '{"ok":true}',
        toolCallId: "tc_1"
      });

      const replayed = new JsonlSessionStore({ directory });
      const messages = await replayed.listMessages("sess_tool_fields");

      expect(messages[0]).toMatchObject({
        role: "assistant",
        content: null,
        toolCalls: [{ id: "tc_1", name: "read_file" }]
      });
      expect(messages[1]).toMatchObject({
        role: "tool",
        content: '{"ok":true}',
        toolCallId: "tc_1"
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("compact_boundary resets messages to summary on replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_boundary",
        createMessageId: (() => {
          let index = 0;
          return () => `msg_${++index}`;
        })(),
        now: (() => {
          let index = 0;
          const timestamps = [
            "2026-05-07T00:00:00.000Z",  // session
            "2026-05-07T00:00:01.000Z",  // user msg
            "2026-05-07T00:00:02.000Z",  // assistant msg
            "2026-05-07T00:00:03.000Z",  // compact_boundary
            "2026-05-07T00:00:04.000Z",  // new user msg after compaction
          ];
          return () => timestamps[index++] ?? "2026-05-07T00:00:05.000Z";
        })()
      });

      const session = await store.createSession({ title: "Compact session" });
      await store.appendMessage({ sessionId: session.id, role: "user", content: "First message" });
      await store.appendMessage({ sessionId: session.id, role: "assistant", content: "First reply" });

      // Append a compact_boundary — this should discard the two earlier messages
      await store.appendCompactBoundary({
        sessionId: session.id,
        summary: "Conversation summary of earlier messages.",
        messagesBefore: 2,
        messagesAfter: 1
      });

      // Append a new message after the boundary
      await store.appendMessage({ sessionId: session.id, role: "user", content: "Post-compaction message" });

      // Replay: should only see summary + post-compaction message
      const replayed = new JsonlSessionStore({ directory });
      const messages = await replayed.listMessages("sess_boundary");

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "system",
        content: "Conversation summary of earlier messages."
      });
      expect(messages[1]).toMatchObject({
        role: "user",
        content: "Post-compaction message"
      });

      // JSONL file should contain a compact_boundary record
      await expect(readFile(join(directory, "sess_boundary.jsonl"), "utf8")).resolves.toContain("\"type\":\"compact_boundary\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("persists trace events and replays them in order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-sessions-"));

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

describe("acquireSessionFileLock", () => {
  test("creates the lock file with pid and startedAt; release removes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");

      const lock = await acquireSessionFileLock(lockPath, { pid: 12345, now: () => 1_000_000 });

      const body = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number; startedAt: number };
      expect(body.pid).toBe(12345);
      expect(body.startedAt).toBe(1_000_000);

      await lock.release();
      await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("release is idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");
      const lock = await acquireSessionFileLock(lockPath, { pid: 1 });
      await lock.release();
      // Second release must not throw.
      await expect(lock.release()).resolves.toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("times out when the lock is held by a live other process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");
      // Plant an existing lock from a "different live pid".
      await writeFile(lockPath, JSON.stringify({ pid: 99999, startedAt: Date.now() }));

      await expect(
        acquireSessionFileLock(lockPath, {
          pid: 1,
          acquireTimeoutMs: 50,
          retryIntervalMs: 5,
          isProcessAlive: () => true
        })
      ).rejects.toThrow(/Timed out acquiring session file lock/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("reclaims a stale lock when the holder pid is dead", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");
      await writeFile(lockPath, JSON.stringify({ pid: 99999, startedAt: Date.now() }));

      const lock = await acquireSessionFileLock(lockPath, {
        pid: 1,
        acquireTimeoutMs: 500,
        retryIntervalMs: 5,
        isProcessAlive: (pid) => pid !== 99999
      });

      const body = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
      expect(body.pid).toBe(1);

      await lock.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("reclaims a stale lock that is older than staleAfterMs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");
      // Plant an old lock from "live" pid but well past stale threshold.
      const oldStartedAt = 1_000_000;
      await writeFile(lockPath, JSON.stringify({ pid: 99999, startedAt: oldStartedAt }));

      const lock = await acquireSessionFileLock(lockPath, {
        pid: 1,
        acquireTimeoutMs: 500,
        retryIntervalMs: 5,
        staleAfterMs: 100,
        now: () => oldStartedAt + 10_000,
        isProcessAlive: () => true
      });

      await lock.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("second acquire waits for first release in-process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-lock-"));
    try {
      const lockPath = join(directory, "sess.lock");
      const first = await acquireSessionFileLock(lockPath, { pid: 1, retryIntervalMs: 5 });

      let secondAcquired = false;
      const secondPromise = acquireSessionFileLock(lockPath, {
        pid: 2,
        retryIntervalMs: 5,
        isProcessAlive: (pid) => pid === 1
      }).then((lock) => {
        secondAcquired = true;
        return lock;
      });

      await new Promise((r) => setTimeout(r, 30));
      expect(secondAcquired).toBe(false);

      await first.release();
      const second = await secondPromise;
      expect(secondAcquired).toBe(true);
      await second.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("default acquire timeout constant is exposed", () => {
    expect(DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS).toBe(60_000);
  });
});

describe("JsonlSessionStore — file lock integration", () => {
  test("acquires and releases the lock around each append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-store-lock-"));
    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_locktest",
        createMessageId: () => "msg_1"
      });

      const session = await store.createSession();
      expect(session.id).toBe("sess_locktest");

      await store.appendMessage({ sessionId: "sess_locktest", role: "user", content: "hi" });

      // Lock file should be cleaned up after each write.
      await expect(stat(join(directory, "sess_locktest.lock"))).rejects.toMatchObject({ code: "ENOENT" });

      // JSONL still contains the writes.
      const content = await readFile(join(directory, "sess_locktest.jsonl"), "utf8");
      expect(content).toContain("\"type\":\"session\"");
      expect(content).toContain("\"type\":\"message\"");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("can be disabled via fileLock.enabled=false", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-store-nolock-"));
    try {
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_nolock",
        createMessageId: () => "msg_1",
        fileLock: { enabled: false }
      });

      await store.createSession();
      await store.appendMessage({ sessionId: "sess_nolock", role: "user", content: "hi" });

      // No .lock file should have been created.
      await expect(stat(join(directory, "sess_nolock.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("serializes concurrent appends inside the same process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vole-store-concurrent-"));
    try {
      let messageCounter = 0;
      const store = new JsonlSessionStore({
        directory,
        createSessionId: () => "sess_concurrent",
        createMessageId: () => `msg_${++messageCounter}`
      });

      await store.createSession();

      const appends = Array.from({ length: 20 }, (_, i) =>
        store.appendMessage({ sessionId: "sess_concurrent", role: "user", content: `msg_${i}` })
      );
      await Promise.all(appends);

      const content = await readFile(join(directory, "sess_concurrent.jsonl"), "utf8");
      const messageLines = content.split("\n").filter((line) => line.includes("\"type\":\"message\""));
      expect(messageLines).toHaveLength(20);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

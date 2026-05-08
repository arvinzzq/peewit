import { describe, expect, test } from "vitest";
import { DefaultContextAssembler, MinimalContextAssembler } from "@vole/context";
import { FakeModelProvider } from "@vole/models";
import { AlwaysAllowPolicy, DefaultPermissionPolicy } from "@vole/permissions";
import { createReadFileTool, createShellTool } from "@vole/tools";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRuntime, createAgent, type RuntimeEvent } from "./index.js";

async function collect(gen: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("createAgent — Layer 0: bare loop", () => {
  test("runs a turn with only a model provider", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "Hello from Layer 0." }])
    });

    const events = await collect(agent.runTurn({ message: "hi", recentMessages: [] }));

    expect(events.at(-1)?.type).toBe("run_completed");
    const assistantEvent = events.find(e => e.type === "assistant_message_created");
    expect(assistantEvent).toBeDefined();
    if (assistantEvent?.type === "assistant_message_created") {
      expect(assistantEvent.message.content).toBe("Hello from Layer 0.");
    }
  });

  test("createAgent returns an AgentRuntime instance", () => {
    const agent = createAgent({
      model: new FakeModelProvider([])
    });
    expect(agent).toBeInstanceOf(AgentRuntime);
  });

  test("layer 0 uses MinimalContextAssembler by default", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "ok" }]),
      systemInstruction: "You are a test agent."
    });

    const events = await collect(agent.runTurn({ message: "ping", recentMessages: [] }));
    const assembled = events.find(e => e.type === "context_assembled");
    expect(assembled).toBeDefined();
    if (assembled?.type === "context_assembled") {
      expect(assembled.systemInstructionIncluded).toBe(true);
    }
  });

  test("layer 0 with no systemInstruction still runs", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "ok" }])
    });
    const events = await collect(agent.runTurn({ message: "hi", recentMessages: [] }));
    expect(events.some(e => e.type === "run_completed")).toBe(true);
  });
});

describe("createAgent — Layer 1: tools", () => {
  test("executes a low-risk tool call end-to-end", async () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vole-test-"));
      await writeFile(join(tmpDir, "hello.txt"), "world");

      const model = new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c1", name: "read_file", input: { path: join(tmpDir, "hello.txt") } }]
        },
        { type: "message", content: "File content is: world" }
      ]);

      const agent = createAgent({
        model,
        tools: [createReadFileTool()],
        permissions: new AlwaysAllowPolicy()
      });

      const events = await collect(agent.runTurn({
        message: "Read hello.txt",
        recentMessages: [],
        sessionId: "s1"
      }));

      expect(events.some(e => e.type === "tool_started")).toBe(true);
      expect(events.some(e => e.type === "tool_completed")).toBe(true);
      expect(events.some(e => e.type === "run_completed")).toBe(true);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true });
    }
  });

  test("empty tools list still runs without tool calls", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "No tools needed." }]),
      tools: []
    });
    const events = await collect(agent.runTurn({ message: "hi", recentMessages: [] }));
    expect(events.some(e => e.type === "run_completed")).toBe(true);
    expect(events.some(e => e.type === "tool_started")).toBe(false);
  });
});

describe("createAgent — Layer 2: permissions", () => {
  test("DefaultPermissionPolicy auto-denies high-risk tools with no approvalResolver", async () => {
    const model = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [{ id: "c1", name: "run_shell", input: { command: "echo hi" } }]
      }
    ]);

    const agent = createAgent({
      model,
      tools: [createShellTool()],
      permissions: new DefaultPermissionPolicy()
    });

    const events = await collect(agent.runTurn({ message: "run shell", recentMessages: [] }));

    expect(events.some(e => e.type === "tool_call_permission_evaluated")).toBe(true);
    expect(events.some(e => e.type === "approval_requested")).toBe(true);
    expect(events.some(e => e.type === "run_failed")).toBe(true);
    expect(events.some(e => e.type === "tool_started")).toBe(false);
  });

  test("AlwaysAllowPolicy permits high-risk tool calls", async () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vole-test-"));

      const model = new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c1", name: "run_shell", input: { command: "echo allowed" } }]
        },
        { type: "message", content: "done" }
      ]);

      const agent = createAgent({
        model,
        tools: [createShellTool()],
        permissions: new AlwaysAllowPolicy(),
        runtime: { mode: "auto", workspace: tmpDir, currentDate: "2026-05-08" }
      });

      const events = await collect(agent.runTurn({ message: "run shell", recentMessages: [] }));

      const permEval = events.find(e => e.type === "tool_call_permission_evaluated");
      expect(permEval).toBeDefined();
      if (permEval?.type === "tool_call_permission_evaluated") {
        expect(permEval.decision.decision).toBe("allow");
      }
      expect(events.some(e => e.type === "tool_completed")).toBe(true);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true });
    }
  });

  test("permission evaluation event is always emitted before tool execution", async () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vole-test-"));
      await writeFile(join(tmpDir, "f.txt"), "x");

      const model = new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c1", name: "read_file", input: { path: join(tmpDir, "f.txt") } }]
        },
        { type: "message", content: "done" }
      ]);

      const agent = createAgent({
        model,
        tools: [createReadFileTool()],
        permissions: new AlwaysAllowPolicy()
      });

      const events = await collect(agent.runTurn({ message: "read", recentMessages: [] }));
      const types = events.map(e => e.type);
      const permIdx = types.indexOf("tool_call_permission_evaluated");
      const startIdx = types.indexOf("tool_started");
      expect(permIdx).toBeGreaterThan(-1);
      expect(startIdx).toBeGreaterThan(permIdx);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true });
    }
  });
});

describe("createAgent — Layer 3: sessions (caller-managed)", () => {
  test("accepts recentMessages to continue a conversation", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "I remember." }])
    });

    const events = await collect(agent.runTurn({
      message: "What did I say before?",
      recentMessages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" }
      ]
    }));

    expect(events.some(e => e.type === "run_completed")).toBe(true);
    const assembled = events.find(e => e.type === "context_assembled");
    if (assembled?.type === "context_assembled") {
      expect(assembled.messageCount).toBeGreaterThan(1);
    }
  });

  test("turn_complete event carries all new messages for session persistence", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "Layer 3 response." }])
    });

    const events = await collect(agent.runTurn({ message: "hello", recentMessages: [] }));
    const turnComplete = events.find(e => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
    if (turnComplete?.type === "turn_complete") {
      expect(turnComplete.messages.length).toBeGreaterThan(0);
      expect(turnComplete.messages.some(m => m.role === "assistant")).toBe(true);
    }
  });
});

describe("createAgent — Layer 4: context assembler", () => {
  test("DefaultContextAssembler produces richer system instruction than MinimalContextAssembler", async () => {
    const instruction = "You are Vole. Help the user.";

    const minimalAgent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "minimal" }]),
      systemInstruction: instruction
    });

    const fullAgent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "full" }]),
      systemInstruction: instruction,
      context: new DefaultContextAssembler(),
      runtime: { mode: "confirm", workspace: process.cwd(), currentDate: "2026-05-08" }
    });

    const minimalEvents = await collect(minimalAgent.runTurn({ message: "hi", recentMessages: [] }));
    const fullEvents = await collect(fullAgent.runTurn({ message: "hi", recentMessages: [] }));

    const minimalAssembled = minimalEvents.find(e => e.type === "context_assembled");
    const fullAssembled = fullEvents.find(e => e.type === "context_assembled");

    expect(minimalAssembled?.type).toBe("context_assembled");
    expect(fullAssembled?.type).toBe("context_assembled");

    if (minimalAssembled?.type === "context_assembled" && fullAssembled?.type === "context_assembled") {
      expect(fullAssembled.messageCount).toBeGreaterThanOrEqual(minimalAssembled.messageCount);
    }
  });

  test("can swap MinimalContextAssembler explicitly", async () => {
    const agent = createAgent({
      model: new FakeModelProvider([{ type: "message", content: "ok" }]),
      context: new MinimalContextAssembler(),
      systemInstruction: "Be brief."
    });
    const events = await collect(agent.runTurn({ message: "hello", recentMessages: [] }));
    expect(events.some(e => e.type === "run_completed")).toBe(true);
  });
});

describe("createAgent — multi-layer combinations", () => {
  test("tools + AlwaysAllowPolicy + DefaultContextAssembler works together", async () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vole-test-"));
      await writeFile(join(tmpDir, "readme.txt"), "Vole agent");

      const model = new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c1", name: "read_file", input: { path: join(tmpDir, "readme.txt") } }]
        },
        { type: "message", content: "Read it successfully." }
      ]);

      const agent = createAgent({
        model,
        systemInstruction: "You are Vole.",
        tools: [createReadFileTool()],
        permissions: new AlwaysAllowPolicy(),
        context: new DefaultContextAssembler(),
        runtime: { mode: "auto", workspace: tmpDir, currentDate: "2026-05-08" }
      });

      const events = await collect(agent.runTurn({ message: "read readme", recentMessages: [] }));

      expect(events.some(e => e.type === "tool_completed")).toBe(true);
      expect(events.some(e => e.type === "run_completed")).toBe(true);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true });
    }
  });

  test("AgentRuntime direct construction still works unchanged", async () => {
    const runtime = new AgentRuntime({
      contextAssembler: new DefaultContextAssembler(),
      modelProvider: new FakeModelProvider([{ type: "message", content: "direct" }]),
      systemInstruction: "direct wiring"
    });
    const events = await collect(runtime.runTurn({ message: "hi", recentMessages: [] }));
    expect(events.some(e => e.type === "run_completed")).toBe(true);
  });
});

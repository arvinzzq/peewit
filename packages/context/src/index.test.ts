import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelProvider } from "@vole/models";
import { DefaultContextAssembler, compactMessages, estimateMessageTokens, parseInlineDirectives, thinToolMessage, type ContextAssembler } from "./index.js";

describe("context assembler sections", () => {
  test("assembles provider-ready messages in deterministic section order", async () => {
    const assembler: ContextAssembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      runtime: {
        mode: "confirm",
        workspace: "/workspace/project",
        currentDate: "2026-05-03"
      },
      userMessage: "Explain the next step."
    });

    expect(result.modelInput.messages).toEqual([
      {
        role: "system",
        content: [
          "<identity>",
          "You are Vole.",
          "</identity>",
          "",
          "<runtime>",
          "- Mode: confirm",
          "- Workspace: /workspace/project",
          "- Date: 2026-05-03",
          "</runtime>"
        ].join("\n")
      },
      {
        role: "user",
        content: "Explain the next step."
      }
    ]);
    expect(result.report.includedSections).toEqual([
      "identity",
      "runtime",
      "user_message"
    ]);
  });

  test("records omitted sections in the report", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello."
    });

    expect(result.report.includedSections).toContain("identity");
    expect(result.report.includedSections).toContain("user_message");
    expect(result.report.omittedSections).toContain("runtime");
    expect(result.report.omittedSections).toContain("tooling");
    expect(result.report.omittedSections).toContain("safety");
    expect(result.report.omittedSections).toContain("skills");
  });

  test("provides per-section detail in the sections report", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello."
    });

    const identitySection = result.report.sections.find((s) => s.name === "identity");
    const runtimeSection = result.report.sections.find((s) => s.name === "runtime");

    expect(identitySection).toMatchObject({ name: "identity", included: true });
    expect(runtimeSection).toMatchObject({ name: "runtime", included: false, reason: expect.any(String) });
  });

  test("includes recent conversation messages before the current user message", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      recentMessages: [
        { role: "user", content: "What did we discuss?" },
        { role: "assistant", content: "We discussed session memory." }
      ],
      userMessage: "Continue from there."
    });

    expect(result.modelInput.messages).toMatchObject([
      { role: "system" },
      { role: "user", content: "What did we discuss?" },
      { role: "assistant", content: "We discussed session memory." },
      { role: "user", content: "Continue from there." }
    ]);
    expect(result.report.includedSections).toContain("identity");
    expect(result.report.includedSections).toContain("conversation_history");
    expect(result.report.includedSections).toContain("user_message");
  });
});

describe("tooling section", () => {
  test("includes tool descriptions in system prompt when tools are provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      tools: [
        { name: "read_file", description: "Read a workspace file.", risk: "low" },
        { name: "run_shell", description: "Run a shell command.", risk: "high" }
      ],
      userMessage: "Read the README."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).toContain("<tooling>");
    expect(systemContent).toContain("read_file [low]: Read a workspace file.");
    expect(systemContent).toContain("run_shell [high]: Run a shell command.");
    expect(systemContent).toContain("</tooling>");
    expect(result.report.includedSections).toContain("tooling");
    expect(result.report.omittedSections).not.toContain("tooling");
  });

  test("omits tooling section when no tools are provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).not.toContain("<tooling>");
    expect(result.report.omittedSections).toContain("tooling");
  });

  test("omits tooling section when tool list is empty", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      tools: [],
      userMessage: "Hello."
    });

    expect(result.report.omittedSections).toContain("tooling");
  });
});

describe("safety section", () => {
  test("includes permission guidance in system prompt when provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      permissionGuidance: "Low-risk actions run automatically. High-risk require approval.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).toContain("<safety>");
    expect(systemContent).toContain("Low-risk actions run automatically.");
    expect(systemContent).toContain("</safety>");
    expect(result.report.includedSections).toContain("safety");
  });

  test("omits safety section when no permission guidance is provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).not.toContain("<safety>");
    expect(result.report.omittedSections).toContain("safety");
  });
});

describe("skills section", () => {
  test("includes skill index in system prompt when skill index is provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      skillIndex: [
        { name: "research", description: "Use when investigating external information or comparing sources." },
        { name: "safe-shell", description: "Use when planning to run shell commands." }
      ],
      userMessage: "Search for information."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).toContain("<skills>");
    expect(systemContent).toContain("research: Use when investigating external information or comparing sources.");
    expect(systemContent).toContain("safe-shell: Use when planning to run shell commands.");
    expect(systemContent).toContain("</skills>");
    expect(result.report.includedSections).toContain("skills");
  });

  test("omits skills section when no skill index is provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).not.toContain("<skills>");
    expect(result.report.omittedSections).toContain("skills");
  });
});

describe("workspace section", () => {
  test("loads configured workspace prompt files into the system message", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-context-workspace-"));

    try {
      await writeFile(join(workspace, "AGENTS.md"), "Use project conventions.");
      await writeFile(join(workspace, "SOUL.md"), "Stay steady and practical.");

      const assembler = new DefaultContextAssembler({
        workspacePromptFiles: ["AGENTS.md", "SOUL.md"]
      });

      const result = await assembler.assemble({
        systemInstruction: "You are Vole.",
        runtime: {
          mode: "confirm",
          workspace,
          currentDate: "2026-05-03"
        },
        userMessage: "Follow the project guidance."
      });

      const systemContent = result.modelInput.messages[0]?.content as string;
      expect(systemContent).toContain("<workspace>");
      expect(systemContent).toContain("### AGENTS.md");
      expect(systemContent).toContain("Use project conventions.");
      expect(systemContent).toContain("### SOUL.md");
      expect(systemContent).toContain("Stay steady and practical.");
      expect(systemContent).toContain("</workspace>");
      expect(result.report.includedSections).toContain("workspace");
      expect(result.report.omittedSections).not.toContain("workspace");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("omits workspace section when no prompt files are found", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vole-context-workspace-"));

    try {
      const assembler = new DefaultContextAssembler({
        workspacePromptFiles: ["AGENTS.md"]
      });

      const result = await assembler.assemble({
        systemInstruction: "You are Vole.",
        runtime: { mode: "confirm", workspace, currentDate: "2026-05-03" },
        userMessage: "Hello."
      });

      const systemContent = result.modelInput.messages[0]?.content as string;
      expect(systemContent).not.toContain("<workspace>");
      expect(result.report.omittedSections).toContain("workspace");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("prompt modes", () => {
  test("assembles full prompt in full mode", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace: "/workspace", currentDate: "2026-05-03" },
      tools: [{ name: "read_file", description: "Read a file.", risk: "low" }],
      permissionGuidance: "Low-risk: automatic.",
      skillIndex: [{ name: "research", description: "Use when investigating." }],
      userMessage: "Hello.",
      promptMode: "full"
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).toContain("<identity>");
    expect(systemContent).toContain("<runtime>");
    expect(systemContent).toContain("<tooling>");
    expect(systemContent).toContain("<safety>");
    expect(systemContent).toContain("<skills>");
    expect(result.report.includedSections).toContain("identity");
    expect(result.report.includedSections).toContain("runtime");
  });

  test("assembles only identity section in minimal mode", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace: "/workspace", currentDate: "2026-05-03" },
      tools: [{ name: "read_file", description: "Read a file.", risk: "low" }],
      permissionGuidance: "Low-risk: automatic.",
      skillIndex: [{ name: "research", description: "Use when investigating." }],
      userMessage: "Hello.",
      promptMode: "minimal"
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).toContain("<identity>");
    expect(systemContent).not.toContain("<runtime>");
    expect(systemContent).not.toContain("<tooling>");
    expect(systemContent).not.toContain("<safety>");
    expect(systemContent).not.toContain("<skills>");
    expect(result.report.includedSections).toContain("identity");
    expect(result.report.includedSections).not.toContain("runtime");
  });

  test("produces no system instruction in none mode", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      userMessage: "Hello.",
      promptMode: "none"
    });

    // No system message in the output
    const messages = result.modelInput.messages;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "Hello." });
    expect(result.report.includedSections).not.toContain("identity");
    expect(result.report.includedSections).toContain("user_message");
  });
});

describe("estimateMessageTokens", () => {
  test("estimates token count from message content characters", () => {
    const messages = [
      { role: "user" as const, content: "A".repeat(400) },
      { role: "assistant" as const, content: null, toolCalls: [{ id: "tc1", name: "bash", input: { cmd: "ls" } }] },
      { role: "tool" as const, content: "B".repeat(400), toolCallId: "tc1" }
    ];
    const tokens = estimateMessageTokens(messages);
    // 400 content + ~32 toolCalls JSON + 400 content + 3 toolCallId = ~835 chars → ceil(835/4) = 209
    expect(tokens).toBeGreaterThan(100);
    expect(tokens).toBeLessThan(500);
  });

  test("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  test("triggers compaction via maxTokens when token count exceeds threshold", async () => {
    // 10 messages each with 1000 chars → ~2500 tokens, well above maxTokens: 100
    const messages = [
      { role: "system" as const, content: "System" },
      ...Array.from({ length: 9 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: "X".repeat(1000)
      }))
    ];
    const provider = new FakeModelProvider([{ type: "message", content: "summary" }]);
    const result = await compactMessages(messages, provider, { maxTokens: 100, maxMessages: 9999, keepRecent: 3 });
    expect(result.length).toBeLessThan(messages.length);
  });
});

describe("compactMessages", () => {
  test("returns messages unchanged when under maxMessages threshold", async () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`
    }));
    const provider = new FakeModelProvider([]);
    const result = await compactMessages(messages, provider, { maxMessages: 10 });
    expect(result).toEqual(messages);
  });

  test("replaces old conversation with summary while preserving the leading system message", async () => {
    const systemMessage = { role: "system" as const, content: "You are a helpful assistant." };
    const messages = [
      systemMessage,
      ...Array.from({ length: 14 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Turn ${i}`
      }))
    ];
    // 15 total (1 system + 14 conversation), maxMessages=10, keepRecent=5
    const provider = new FakeModelProvider([{ type: "message", content: "Summary of old conversation." }]);
    const result = await compactMessages(messages, provider, { maxMessages: 10, keepRecent: 5 });

    // Should be: original system message + summary system message + 5 recent = 7
    expect(result).toHaveLength(7);
    // result[0] is the preserved identity/system prompt — unchanged
    expect(result[0]).toEqual(systemMessage);
    // result[1] is the compacted history summary
    expect(result[1]?.role).toBe("system");
    expect(result[1]?.content).toContain("Conversation summary:");
    expect(result[1]?.content).toContain("Summary of old conversation.");
    // Verify the 5 recent conversation messages are preserved verbatim
    for (let i = 2; i <= 6; i++) {
      expect(result[i]).toEqual(messages[messages.length - 5 + (i - 2)]);
    }
  });

  test("returns thinned messages (not originals) when distillation model call fails", async () => {
    // Place the large tool message early so it falls in the old portion (not recent).
    // Layout: system + tool(old) + 8 user/assistant(old) + 5 user/assistant(recent) = 15 total
    // maxMessages=10, keepRecent=5 → old = conversation[0..8] which includes the tool message.
    const toolResultContent = JSON.stringify({ ok: true, content: "x".repeat(1000), summary: "Read foo.txt." });
    const messages = [
      { role: "system" as const, content: "System." },
      { role: "tool" as const, content: toolResultContent, toolCallId: "tc_1" },
      ...Array.from({ length: 13 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Turn ${i}`
      }))
    ];
    // 15 total (1 system + 14 conversation), maxMessages=10, keepRecent=5
    // old = conversation[0..8] = tool + 8 user/assistant messages
    const provider = new FakeModelProvider([
      { type: "error", category: "unknown", message: "Model failed", recoverable: false }
    ]);
    const result = await compactMessages(messages, provider, { maxMessages: 10, keepRecent: 5 });
    // Must not equal the original — tool output should be stripped from old portion
    expect(result).not.toEqual(messages);
    // The large raw content must be gone
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("x".repeat(100));
    // But the summary must still be present
    expect(resultStr).toContain("Read foo.txt.");
    // The 5 recent messages are verbatim
    expect(result.slice(-5)).toEqual(messages.slice(-5));
  });

  test("thinToolMessage strips content but keeps summary and metadata", () => {
    const large = JSON.stringify({
      ok: true,
      content: "A".repeat(5000),
      summary: "Read large-file.ts.",
      exitCode: undefined
    });
    const msg = { role: "tool" as const, content: large, toolCallId: "tc_1" };
    const thinned = thinToolMessage(msg);
    expect(thinned.role).toBe("tool");
    const parsed = JSON.parse(thinned.content ?? "{}") as Record<string, unknown>;
    expect(parsed["ok"]).toBe(true);
    expect(parsed["summary"]).toBe("Read large-file.ts.");
    expect("content" in parsed).toBe(false);
    expect(JSON.stringify(thinned).length).toBeLessThan(large.length / 10);
  });

  test("thinToolMessage preserves non-JSON content up to 400 chars", () => {
    const long = "x".repeat(600);
    const msg = { role: "tool" as const, content: long, toolCallId: "tc_2" };
    const thinned = thinToolMessage(msg);
    expect(thinned.content?.length).toBeLessThanOrEqual(450);
    expect(thinned.content).toContain("chars omitted");
  });

  test("recent messages are always preserved verbatim regardless of content size", async () => {
    // Ensure keepRecent messages are returned exactly as-is, never thinned or modified.
    const largeToolContent = JSON.stringify({ ok: true, content: "B".repeat(2000), summary: "Recent tool." });
    const messages = [
      { role: "system" as const, content: "System." },
      ...Array.from({ length: 9 }, (_, i) => ({ role: "user" as const, content: `Old ${i}` })),
      { role: "tool" as const, content: largeToolContent, toolCallId: "recent_tc" }
    ];
    // 11 total, maxMessages=10, keepRecent=5 → last 5 are in recent (includes the tool message)
    const provider = new FakeModelProvider([{ type: "message", content: "Summary." }]);
    const result = await compactMessages(messages, provider, { maxMessages: 10, keepRecent: 5 });
    // The recent tool message must be verbatim — not thinned
    const recentTool = result.find((m) => m.role === "tool" && m.toolCallId === "recent_tc");
    expect(recentTool?.content).toBe(largeToolContent);
  });
});

describe("full context assembly", () => {
  test("assembles all sections in deterministic order", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are Vole.",
      runtime: { mode: "confirm", workspace: "/workspace", currentDate: "2026-05-03" },
      tools: [{ name: "read_file", description: "Read a file.", risk: "low" }],
      permissionGuidance: "Low-risk: automatic. High-risk: approval required.",
      skillIndex: [{ name: "research", description: "Use when investigating external information or comparing sources." }],
      userMessage: "Help me."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    const identityPos = systemContent.indexOf("<identity>");
    const runtimePos = systemContent.indexOf("<runtime>");
    const toolingPos = systemContent.indexOf("<tooling>");
    const safetyPos = systemContent.indexOf("<safety>");
    const skillsPos = systemContent.indexOf("<skills>");

    expect(identityPos).toBeLessThan(runtimePos);
    expect(runtimePos).toBeLessThan(toolingPos);
    expect(toolingPos).toBeLessThan(safetyPos);
    expect(safetyPos).toBeLessThan(skillsPos);

    expect(result.report.includedSections).toEqual([
      "identity",
      "runtime",
      "tooling",
      "safety",
      "skills",
      "user_message"
    ]);
  });
});

describe("parseInlineDirectives (Phase 13 Step 7)", () => {
  test("returns the original message unchanged when no directives are present", () => {
    const parsed = parseInlineDirectives("Please summarize the changelog.");
    expect(parsed.cleanedMessage).toBe("Please summarize the changelog.");
    expect(parsed.directives).toEqual({ stop: false, compact: false });
  });

  test("strips /think:<level> and returns it on the directives object", () => {
    const parsed = parseInlineDirectives("/think:high refactor the auth module");
    expect(parsed.cleanedMessage).toBe("refactor the auth module");
    expect(parsed.directives.think).toBe("high");
  });

  test("ignores unknown think levels", () => {
    const parsed = parseInlineDirectives("/think:nonsense rebuild the index");
    expect(parsed.cleanedMessage).toBe("rebuild the index");
    expect(parsed.directives.think).toBeUndefined();
  });

  test("captures /stop and removes the token from the cleaned message", () => {
    const parsed = parseInlineDirectives("Please /stop the run before tests fail.");
    expect(parsed.directives.stop).toBe(true);
    expect(parsed.cleanedMessage).not.toMatch(/\/stop/);
  });

  test("captures /compact and removes the token from the cleaned message", () => {
    const parsed = parseInlineDirectives("/compact and then summarize the diff");
    expect(parsed.directives.compact).toBe(true);
    expect(parsed.cleanedMessage).toBe("and then summarize the diff");
  });

  test("handles multiple directives in one message", () => {
    const parsed = parseInlineDirectives("/think:max /compact please rewrite the README");
    expect(parsed.directives.think).toBe("max");
    expect(parsed.directives.compact).toBe(true);
    expect(parsed.cleanedMessage).toBe("please rewrite the README");
  });

  test("a message consisting only of directives leaves cleanedMessage empty", () => {
    const parsed = parseInlineDirectives("/stop");
    expect(parsed.cleanedMessage).toBe("");
    expect(parsed.directives.stop).toBe(true);
  });
});

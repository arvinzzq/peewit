import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelProvider } from "@arvinclaw/models";
import { DefaultContextAssembler, compactMessages, type ContextAssembler } from "./index.js";

describe("context assembler sections", () => {
  test("assembles provider-ready messages in deterministic section order", async () => {
    const assembler: ContextAssembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are ArvinClaw.",
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
          "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).not.toContain("<tooling>");
    expect(result.report.omittedSections).toContain("tooling");
  });

  test("omits tooling section when tool list is empty", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
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
      systemInstruction: "You are ArvinClaw.",
      userMessage: "Hello."
    });

    const systemContent = result.modelInput.messages[0]?.content as string;
    expect(systemContent).not.toContain("<skills>");
    expect(result.report.omittedSections).toContain("skills");
  });
});

describe("workspace section", () => {
  test("loads configured workspace prompt files into the system message", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-context-workspace-"));

    try {
      await writeFile(join(workspace, "AGENTS.md"), "Use project conventions.");
      await writeFile(join(workspace, "SOUL.md"), "Stay steady and practical.");

      const assembler = new DefaultContextAssembler({
        workspacePromptFiles: ["AGENTS.md", "SOUL.md"]
      });

      const result = await assembler.assemble({
        systemInstruction: "You are ArvinClaw.",
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
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-context-workspace-"));

    try {
      const assembler = new DefaultContextAssembler({
        workspacePromptFiles: ["AGENTS.md"]
      });

      const result = await assembler.assemble({
        systemInstruction: "You are ArvinClaw.",
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

  test("replaces old messages with summary when over threshold", async () => {
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant." },
      ...Array.from({ length: 14 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Turn ${i}`
      }))
    ];
    // 15 total messages, maxMessages=10, keepRecent=5
    const provider = new FakeModelProvider([{ type: "message", content: "Summary of old conversation." }]);
    const result = await compactMessages(messages, provider, { maxMessages: 10, keepRecent: 5 });

    // Should be 1 summary system message + 5 recent messages = 6
    expect(result).toHaveLength(6);
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("Conversation summary:");
    expect(result[0]?.content).toContain("Summary of old conversation.");
    // Verify the 5 recent messages are preserved
    for (let i = 1; i <= 5; i++) {
      expect(result[i]).toEqual(messages[messages.length - 5 + (i - 1)]);
    }
  });

  test("returns original messages when model call fails", async () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`
    }));
    const provider = new FakeModelProvider([
      { type: "error", category: "unknown", message: "Model failed", recoverable: false }
    ]);
    const result = await compactMessages(messages, provider, { maxMessages: 10, keepRecent: 5 });
    expect(result).toEqual(messages);
  });
});

describe("full context assembly", () => {
  test("assembles all sections in deterministic order", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are ArvinClaw.",
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

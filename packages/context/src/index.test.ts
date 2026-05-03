import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultContextAssembler, type ContextAssembler } from "./index.js";

describe("minimal context assembler", () => {
  test("assembles provider-ready messages in deterministic order", async () => {
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
          "You are ArvinClaw.",
          "",
          "Runtime:",
          "- Mode: confirm",
          "- Workspace: /workspace/project",
          "- Current date: 2026-05-03"
        ].join("\n")
      },
      {
        role: "user",
        content: "Explain the next step."
      }
    ]);
    expect(result.report.includedSections).toEqual([
      "system_instruction",
      "runtime_metadata",
      "user_message"
    ]);
  });

  test("records omitted runtime metadata when it is not provided", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are ArvinClaw.",
      userMessage: "Hello."
    });

    expect(result.modelInput.messages).toEqual([
      {
        role: "system",
        content: "You are ArvinClaw."
      },
      {
        role: "user",
        content: "Hello."
      }
    ]);
    expect(result.report.omittedSections).toEqual(["runtime_metadata"]);
  });

  test("includes recent conversation messages before the current user message", async () => {
    const assembler = new DefaultContextAssembler();

    const result = await assembler.assemble({
      systemInstruction: "You are ArvinClaw.",
      recentMessages: [
        {
          role: "user",
          content: "What did we discuss?"
        },
        {
          role: "assistant",
          content: "We discussed session memory."
        }
      ],
      userMessage: "Continue from there."
    });

    expect(result.modelInput.messages).toEqual([
      {
        role: "system",
        content: "You are ArvinClaw."
      },
      {
        role: "user",
        content: "What did we discuss?"
      },
      {
        role: "assistant",
        content: "We discussed session memory."
      },
      {
        role: "user",
        content: "Continue from there."
      }
    ]);
    expect(result.report.includedSections).toEqual([
      "system_instruction",
      "conversation_history",
      "user_message"
    ]);
  });

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

      expect(result.modelInput.messages[0]).toEqual({
        role: "system",
        content: [
          "You are ArvinClaw.",
          "",
          "Runtime:",
          "- Mode: confirm",
          `- Workspace: ${workspace}`,
          "- Current date: 2026-05-03",
          "",
          "Workspace prompt files:",
          "",
          "### AGENTS.md",
          "Use project conventions.",
          "",
          "### SOUL.md",
          "Stay steady and practical."
        ].join("\n")
      });
      expect(result.report.includedSections).toContain("workspace_prompt_files");
      expect(result.report.omittedSections).not.toContain("workspace_prompt_files");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("omits missing configured workspace prompt files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arvinclaw-context-workspace-"));

    try {
      const assembler = new DefaultContextAssembler({
        workspacePromptFiles: ["AGENTS.md"]
      });

      const result = await assembler.assemble({
        systemInstruction: "You are ArvinClaw.",
        runtime: {
          mode: "confirm",
          workspace,
          currentDate: "2026-05-03"
        },
        userMessage: "Hello."
      });

      expect(result.modelInput.messages[0]?.content).not.toContain("Workspace prompt files:");
      expect(result.report.omittedSections).toContain("workspace_prompt_files");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

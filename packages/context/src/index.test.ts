import { describe, expect, test } from "vitest";
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
});

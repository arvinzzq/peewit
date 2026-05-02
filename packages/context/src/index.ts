import type { ModelInput } from "@arvinclaw/models";

export const contextPackageName = "@arvinclaw/context";

export interface ContextRuntimeMetadata {
  mode: string;
  workspace: string;
  currentDate: string;
}

export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  userMessage: string;
}

export interface ContextAssemblyReport {
  includedSections: string[];
  omittedSections: string[];
}

export interface ContextAssemblyResult {
  modelInput: ModelInput;
  report: ContextAssemblyReport;
}

export interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>;
}

export class DefaultContextAssembler implements ContextAssembler {
  async assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult> {
    const includedSections = ["system_instruction"];
    const omittedSections: string[] = [];
    const systemContent = [input.systemInstruction];

    if (input.runtime) {
      includedSections.push("runtime_metadata");
      systemContent.push(
        "",
        "Runtime:",
        `- Mode: ${input.runtime.mode}`,
        `- Workspace: ${input.runtime.workspace}`,
        `- Current date: ${input.runtime.currentDate}`
      );
    } else {
      omittedSections.push("runtime_metadata");
    }

    includedSections.push("user_message");

    return {
      modelInput: {
        messages: [
          {
            role: "system",
            content: systemContent.join("\n")
          },
          {
            role: "user",
            content: input.userMessage
          }
        ]
      },
      report: {
        includedSections,
        omittedSections
      }
    };
  }
}

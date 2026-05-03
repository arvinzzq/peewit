/**
 * INPUT: Model message types plus system instructions, runtime metadata, recent conversation messages, and user messages.
 * OUTPUT: Provider-neutral model input with optional short-term conversation history and a context assembly report.
 * POS: Context assembly layer; decides what the model sees before provider formatting.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { ModelInput, ModelMessage } from "@arvinclaw/models";

export const contextPackageName = "@arvinclaw/context";

export interface ContextRuntimeMetadata {
  mode: string;
  workspace: string;
  currentDate: string;
}

export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  recentMessages?: ModelMessage[];
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

    const recentMessages = input.recentMessages ?? [];

    if (recentMessages.length > 0) {
      includedSections.push("conversation_history");
    }

    includedSections.push("user_message");

    return {
      modelInput: {
        messages: [
          {
            role: "system",
            content: systemContent.join("\n")
          },
          ...recentMessages.map((message) => ({ ...message })),
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

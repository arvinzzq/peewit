/**
 * INPUT: Model message types plus system instructions, runtime metadata, workspace prompt files, recent conversation messages, and user messages.
 * OUTPUT: Provider-neutral model input with optional workspace instructions, short-term conversation history, and a context assembly report.
 * POS: Context assembly layer; decides what the model sees before provider formatting.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { ModelInput, ModelMessage } from "@arvinclaw/models";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

export interface DefaultContextAssemblerDependencies {
  workspacePromptFiles?: string[];
  readWorkspaceFile?: (path: string) => Promise<string>;
}

export class DefaultContextAssembler implements ContextAssembler {
  readonly #workspacePromptFiles: string[];
  readonly #readWorkspaceFile: (path: string) => Promise<string>;

  constructor(dependencies: DefaultContextAssemblerDependencies = {}) {
    this.#workspacePromptFiles = dependencies.workspacePromptFiles ?? [];
    this.#readWorkspaceFile = dependencies.readWorkspaceFile ?? ((path) => readFile(path, "utf8"));
  }

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

    const workspacePromptSections = await this.#loadWorkspacePromptSections(input.runtime?.workspace);

    if (workspacePromptSections.length > 0) {
      includedSections.push("workspace_prompt_files");
      systemContent.push("", "Workspace prompt files:", ...workspacePromptSections);
    } else if (this.#workspacePromptFiles.length > 0) {
      omittedSections.push("workspace_prompt_files");
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

  async #loadWorkspacePromptSections(workspace: string | undefined): Promise<string[]> {
    if (workspace === undefined || this.#workspacePromptFiles.length === 0) {
      return [];
    }

    const sections: string[] = [];

    for (const fileName of this.#workspacePromptFiles) {
      try {
        const content = await this.#readWorkspaceFile(join(workspace, fileName));
        const trimmedContent = content.trim();

        if (trimmedContent.length > 0) {
          sections.push("", `### ${fileName}`, trimmedContent);
        }
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }

    return sections;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

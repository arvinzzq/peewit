/**
 * INPUT: System instructions, runtime metadata, tool summaries, skill index, permission guidance, workspace prompt files, recent conversation messages, and user messages.
 * OUTPUT: Provider-neutral model input assembled from named sections, conversation history, and a per-section context assembly report.
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

export type ContextToolRiskLevel = "low" | "medium" | "high" | "blocked";

export interface ContextToolSummary {
  name: string;
  description: string;
  risk: ContextToolRiskLevel;
}

export interface ContextSkillSummary {
  name: string;
  description: string;
  when: string;
}

export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  tools?: ContextToolSummary[];
  skillIndex?: ContextSkillSummary[];
  permissionGuidance?: string;
  recentMessages?: ModelMessage[];
  userMessage: string;
}

export interface ContextSectionReport {
  name: string;
  included: boolean;
  reason?: string;
}

export interface ContextAssemblyReport {
  includedSections: string[];
  omittedSections: string[];
  sections: ContextSectionReport[];
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
    const sectionReports: ContextSectionReport[] = [];
    const systemParts: string[] = [];

    // identity: who ArvinClaw is
    systemParts.push(input.systemInstruction);
    sectionReports.push({ name: "identity", included: true });

    // runtime: current mode, workspace, date
    if (input.runtime) {
      systemParts.push(
        "",
        "Runtime:",
        `- Mode: ${input.runtime.mode}`,
        `- Workspace: ${input.runtime.workspace}`,
        `- Current date: ${input.runtime.currentDate}`
      );
      sectionReports.push({ name: "runtime", included: true });
    } else {
      sectionReports.push({ name: "runtime", included: false, reason: "No runtime metadata provided." });
    }

    // tooling: available tools with name, description, risk level
    if (input.tools !== undefined && input.tools.length > 0) {
      systemParts.push("", "Tools:", ...input.tools.map((t) => `- ${t.name} [${t.risk}]: ${t.description}`));
      sectionReports.push({ name: "tooling", included: true });
    } else {
      sectionReports.push({ name: "tooling", included: false, reason: "No tools registered." });
    }

    // safety: permission policy guidance
    if (input.permissionGuidance !== undefined && input.permissionGuidance.length > 0) {
      systemParts.push("", "Permissions:", input.permissionGuidance);
      sectionReports.push({ name: "safety", included: true });
    } else {
      sectionReports.push({ name: "safety", included: false, reason: "No permission guidance provided." });
    }

    // skills: compact skill index (name + when to use)
    if (input.skillIndex !== undefined && input.skillIndex.length > 0) {
      systemParts.push("", "Skills:", ...input.skillIndex.map((s) => `- ${s.name}: ${s.when}`));
      sectionReports.push({ name: "skills", included: true });
    } else {
      sectionReports.push({ name: "skills", included: false, reason: "No skills loaded." });
    }

    // workspace: AGENTS.md, SOUL.md, and other prompt files
    const workspaceContent = await this.#loadWorkspacePromptSections(input.runtime?.workspace);
    if (workspaceContent.length > 0) {
      systemParts.push("", "Workspace prompt files:", ...workspaceContent);
      sectionReports.push({ name: "workspace", included: true });
    } else if (this.#workspacePromptFiles.length > 0) {
      sectionReports.push({ name: "workspace", included: false, reason: "No workspace prompt files found." });
    }

    // conversation history
    const recentMessages = input.recentMessages ?? [];
    if (recentMessages.length > 0) {
      sectionReports.push({ name: "conversation_history", included: true });
    }

    // user message is always present
    sectionReports.push({ name: "user_message", included: true });

    const includedSections = sectionReports.filter((s) => s.included).map((s) => s.name);
    const omittedSections = sectionReports.filter((s) => !s.included).map((s) => s.name);

    return {
      modelInput: {
        messages: [
          { role: "system", content: systemParts.join("\n") },
          ...recentMessages.map((message) => ({ ...message })),
          { role: "user", content: input.userMessage }
        ]
      },
      report: { includedSections, omittedSections, sections: sectionReports }
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

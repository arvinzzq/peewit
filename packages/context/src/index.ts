/**
 * INPUT: System instructions, runtime metadata, tool summaries, skill index, permission guidance, workspace prompt files, recent conversation messages, user messages, prompt mode, compaction options, and model provider for summarization.
 * OUTPUT: Provider-neutral model input assembled from named sections, conversation history, a per-section context assembly report, compacted message histories via compactMessages, and PromptMode type for full/minimal/none assembly control.
 * POS: Context assembly layer; decides what the model sees before provider formatting.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { ModelInput, ModelMessage, ModelProvider } from "@peewit/models";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const contextPackageName = "@peewit/context";

export type PromptMode = "full" | "minimal" | "none";

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
}

export interface ContextAssemblyInput {
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  tools?: ContextToolSummary[];
  skillIndex?: ContextSkillSummary[];
  permissionGuidance?: string;
  recentMessages?: ModelMessage[];
  userMessage: string;
  promptMode?: PromptMode;
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
    const mode = input.promptMode ?? "full";
    const sectionReports: ContextSectionReport[] = [];
    const systemParts: string[] = [];

    if (mode === "none") {
      // No system instruction at all
      const recentMessages = input.recentMessages ?? [];
      if (recentMessages.length > 0) {
        sectionReports.push({ name: "conversation_history", included: true });
      }
      sectionReports.push({ name: "user_message", included: true });

      const includedSections = sectionReports.filter((s) => s.included).map((s) => s.name);
      const omittedSections = sectionReports.filter((s) => !s.included).map((s) => s.name);

      return {
        modelInput: {
          messages: [
            ...recentMessages.map((message) => ({ ...message })),
            { role: "user", content: input.userMessage }
          ]
        },
        report: { includedSections, omittedSections, sections: sectionReports }
      };
    }

    // identity: who Peewit is (always included in full and minimal)
    systemParts.push(`<identity>\n${input.systemInstruction}\n</identity>`);
    sectionReports.push({ name: "identity", included: true });

    if (mode === "full") {
      // runtime: current mode, workspace, date
      if (input.runtime) {
        systemParts.push(
          "",
          `<runtime>\n- Mode: ${input.runtime.mode}\n- Workspace: ${input.runtime.workspace}\n- Date: ${input.runtime.currentDate}\n</runtime>`
        );
        sectionReports.push({ name: "runtime", included: true });
      } else {
        sectionReports.push({ name: "runtime", included: false, reason: "No runtime metadata provided." });
      }

      // tooling: available tools with name, description, risk level
      if (input.tools !== undefined && input.tools.length > 0) {
        const toolLines = input.tools.map((t) => `- ${t.name} [${t.risk}]: ${t.description}`).join("\n");
        systemParts.push("", `<tooling>\n${toolLines}\n</tooling>`);
        sectionReports.push({ name: "tooling", included: true });
      } else {
        sectionReports.push({ name: "tooling", included: false, reason: "No tools registered." });
      }

      // safety: permission policy guidance
      if (input.permissionGuidance !== undefined && input.permissionGuidance.length > 0) {
        systemParts.push("", `<safety>\n${input.permissionGuidance}\n</safety>`);
        sectionReports.push({ name: "safety", included: true });
      } else {
        sectionReports.push({ name: "safety", included: false, reason: "No permission guidance provided." });
      }

      // skills: compact skill index (name + description as routing trigger)
      if (input.skillIndex !== undefined && input.skillIndex.length > 0) {
        const skillLines = input.skillIndex.map((s) => `- ${s.name}: ${s.description}`).join("\n");
        systemParts.push("", `<skills>\n${skillLines}\n</skills>`);
        sectionReports.push({ name: "skills", included: true });
      } else {
        sectionReports.push({ name: "skills", included: false, reason: "No skills loaded." });
      }

      // workspace: AGENTS.md, SOUL.md, and other prompt files
      const workspaceContent = await this.#loadWorkspacePromptSections(input.runtime?.workspace);
      if (workspaceContent.length > 0) {
        systemParts.push("", `<workspace>${workspaceContent.join("\n")}\n</workspace>`);
        sectionReports.push({ name: "workspace", included: true });
      } else if (this.#workspacePromptFiles.length > 0) {
        sectionReports.push({ name: "workspace", included: false, reason: "No workspace prompt files found." });
      }
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

// ─── Compaction ────────────────────────────────────────────────────────────────

export interface CompactionOptions {
  maxMessages: number;
  keepRecent: number;
  summarySystemPrompt: string;
}

export const DEFAULT_COMPACTION_OPTIONS: CompactionOptions = {
  maxMessages: 30,
  keepRecent: 12,
  summarySystemPrompt:
    "You are a conversation summarizer. Produce a concise factual summary of the conversation history. Preserve tool calls made, decisions reached, key facts discovered, and current task state. Be brief."
};

export async function compactMessages(
  messages: ModelMessage[],
  modelProvider: ModelProvider,
  options?: Partial<CompactionOptions>
): Promise<ModelMessage[]> {
  const opts: CompactionOptions = { ...DEFAULT_COMPACTION_OPTIONS, ...options };

  if (messages.length <= opts.maxMessages) {
    return messages;
  }

  const old = messages.slice(0, messages.length - opts.keepRecent);
  const recent = messages.slice(-opts.keepRecent);

  if (old.length === 0) {
    return messages;
  }

  const transcript = old
    .map((m) => `${m.role.toUpperCase()}: ${m.content ?? "(tool call)"}`)
    .join("\n");

  try {
    const output = await modelProvider.generate({
      messages: [
        { role: "system", content: opts.summarySystemPrompt },
        { role: "user", content: `Conversation to summarize:\n\n${transcript}` }
      ]
    });

    if (output.type !== "message" || !output.content) {
      return messages;
    }

    return [
      { role: "system", content: `Conversation summary:\n${output.content}` },
      ...recent
    ];
  } catch {
    return messages;
  }
}

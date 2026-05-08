/**
 * INPUT: System instructions, runtime metadata, tool summaries, skill index, permission guidance, workspace prompt files, recent conversation messages, user messages, prompt mode, compaction options, and model provider for summarization.
 * OUTPUT: Provider-neutral model input assembled from named sections, conversation history, a per-section context assembly report, compacted message histories via compactMessages, PromptMode type for full/minimal/none assembly control, and MinimalContextAssembler as the null/pass-through implementation.
 * POS: Context assembly layer; decides what the model sees before provider formatting.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { ModelInput, ModelMessage, ModelProvider } from "@vole/models";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const contextPackageName = "@vole/context";

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

export class MinimalContextAssembler implements ContextAssembler {
  async assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult> {
    const messages: ModelMessage[] = [];
    if (input.systemInstruction) {
      messages.push({ role: "system", content: input.systemInstruction });
    }
    if (input.recentMessages) {
      messages.push(...input.recentMessages);
    }
    messages.push({ role: "user", content: input.userMessage });
    return {
      modelInput: { messages },
      report: {
        includedSections: input.systemInstruction ? ["identity"] : [],
        omittedSections: ["runtime", "tooling", "safety", "skills", "workspace"],
        sections: []
      }
    };
  }
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

    // identity: who Vole is (always included in full and minimal)
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
  /** Token-based trigger: compact when estimated token count exceeds this. Default: 60 000. */
  maxTokens: number;
  /** Message-count fallback: compact when message count exceeds this. Default: 400. */
  maxMessages: number;
  keepRecent: number;
  summarySystemPrompt: string;
}

export const DEFAULT_COMPACTION_OPTIONS: CompactionOptions = {
  maxTokens: 60_000,
  maxMessages: 400,
  keepRecent: 12,
  summarySystemPrompt:
    "You are a context distiller for an AI agent. The conversation history has grown too long and must be reduced. Extract only what the agent needs to continue working: tools called and their key outcomes, decisions reached, important facts discovered, files created or modified, errors encountered, and the current task state. Discard pleasantries, repetition, and details that no longer affect the agent's ability to proceed. Output concise factual statements only."
};

/**
 * Rough token count estimate for a message array using chars/4 heuristic.
 * Accurate enough for compaction triggering; avoids an API round-trip.
 */
export function estimateMessageTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") chars += msg.content.length;
    if (msg.toolCalls !== undefined) chars += JSON.stringify(msg.toolCalls).length;
    if (msg.toolCallId !== undefined) chars += msg.toolCallId.length;
  }
  return Math.ceil(chars / 4);
}

export async function compactMessages(
  messages: ModelMessage[],
  modelProvider: ModelProvider,
  options?: Partial<CompactionOptions>
): Promise<ModelMessage[]> {
  const opts: CompactionOptions = { ...DEFAULT_COMPACTION_OPTIONS, ...options };

  const shouldCompact =
    estimateMessageTokens(messages) > opts.maxTokens ||
    messages.length > opts.maxMessages;

  if (!shouldCompact) {
    return messages;
  }

  // Preserve the leading system message (identity, tooling, safety guidance) so the
  // agent retains its operating context after compaction. Only the conversation
  // history is distilled — not the instructions that govern behaviour.
  const leadingSystem = messages[0]?.role === "system" ? messages[0] : undefined;
  const conversation = leadingSystem !== undefined ? messages.slice(1) : messages;

  const old = conversation.slice(0, conversation.length - opts.keepRecent);
  // The most recent keepRecent messages are preserved verbatim — they represent
  // the agent's current working memory and must not be altered or summarised.
  const recent = conversation.slice(-opts.keepRecent);

  if (old.length === 0) {
    return messages;
  }

  // Phase 1 — mechanical reduction (free, no model call):
  // Replace tool result messages in the old portion with summary-only versions.
  // Tool outputs (file contents, shell stdout, web pages) are the largest part of
  // context but their raw data is no longer needed once the agent has processed them.
  // Using summaries here makes the distillation transcript cheaper and keeps the
  // resulting summary focused on decisions and outcomes rather than raw data.
  const thinnedOld = old.map(thinToolMessage);

  // Build the minimal representation of the old context for distillation.
  const thinnedMessages: ModelMessage[] = [
    ...(leadingSystem !== undefined ? [leadingSystem] : []),
    ...thinnedOld,
    ...recent
  ];

  const transcript = thinnedOld
    .map((m) => `${m.role.toUpperCase()}: ${m.content ?? "(tool call)"}`)
    .join("\n");

  // Phase 2 — semantic reduction (one model call):
  // Distil the thinned old context into a compact summary. On failure, fall back
  // to the thinned-but-not-summarised messages rather than the original — this
  // ensures tool output content is never restored to context after a failed call.
  try {
    const output = await modelProvider.generate({
      messages: [
        { role: "system", content: opts.summarySystemPrompt },
        { role: "user", content: `Conversation to distil:\n\n${transcript}` }
      ]
    });

    if (output.type !== "message" || !output.content) {
      return thinnedMessages;
    }

    return [
      ...(leadingSystem !== undefined ? [leadingSystem] : []),
      { role: "system", content: `Conversation summary:\n${output.content}` },
      ...recent
    ];
  } catch {
    return thinnedMessages;
  }
}

// Replace a tool result message's large content blobs with a summary-only version.
// Exported so adapters and tests can use it independently.
// Tool results carry a `summary` field ("Read file foo.ts.", "Ran in 234ms exit 0.")
// that captures what happened without the raw data. Once the agent has moved past
// a tool call, the raw content (file text, stdout, web page) adds no value but
// consumes significant tokens in the distillation transcript.
export function thinToolMessage(message: ModelMessage): ModelMessage {
  if (message.role !== "tool" || message.content === null) {
    return message;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    // Not JSON — truncate raw string if very large to bound distillation cost.
    return message.content.length > 400
      ? { ...message, content: `${message.content.slice(0, 400)}\n[${message.content.length - 400} chars omitted]` }
      : message;
  }

  // Build a slim version: keep operational metadata, drop large content blobs.
  const slim: Record<string, unknown> = {};
  if ("ok" in parsed) slim["ok"] = parsed["ok"];
  if ("summary" in parsed && typeof parsed["summary"] === "string") slim["summary"] = parsed["summary"];
  if ("exitCode" in parsed) slim["exitCode"] = parsed["exitCode"];
  if ("error" in parsed) slim["error"] = parsed["error"];
  if ("type" in parsed) slim["type"] = parsed["type"];
  // Preserve short string results (e.g. subagent outputs under 200 chars).
  if ("result" in parsed && typeof parsed["result"] === "string" && (parsed["result"] as string).length <= 200) {
    slim["result"] = parsed["result"];
  }

  return { ...message, content: JSON.stringify(slim) };
}

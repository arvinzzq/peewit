/**
 * INPUT: ModelProvider (required), and optionally: ContextAssembler (defaults to MinimalContextAssembler), systemInstruction, PermissionPolicy (defaults to DefaultPermissionPolicy), ApprovalResolver, tools, hooks, ExecutionContract, maxSteps, runtime metadata, user turn input, recent messages.
 * OUTPUT: createAgent() factory, AgentRuntime, CreateAgentOptions, runtime events (turn_complete, compaction_triggered+summary, memory_flush_triggered, token_delta, todos_updated, planning_stall_detected, tool/permission/approval), SubagentFactory, spawn tools, AsyncTaskStore, trace store.
 * POS: Core runtime layer; coordinates a turn without owning adapters or vendor APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type {
  CompactionOptions,
  ContextAssembler,
  ContextRuntimeMetadata,
  ContextSkillSummary,
  ContextToolSummary,
  PromptMode
} from "@vole/context";
import {
  compactMessages,
  DEFAULT_COMPACTION_OPTIONS,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  estimateMessageTokens,
  MinimalContextAssembler
} from "@vole/context";
import { isStreamingProvider } from "@vole/models";
import type { ModelMessage, ModelOutput, ModelProvider, ModelUsage, ModelToolCall, ModelToolDefinition } from "@vole/models";
import {
  DefaultPermissionPolicy,
  type AutonomyMode,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRiskLevel
} from "@vole/permissions";
import { createUpdateTodosTool, type CheckSubagentResult, type ExecutableTool, type TodoItem, type ToolExecutionContext, type ToolExecutionResult, type SpawnSubagentResult, type SpawnSubagentAsyncResult } from "@vole/tools";

export const corePackageName = "@vole/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
  "memory_flush_triggered",
  "compaction_triggered",
  "todos_updated",
  "planning_stall_detected",
  "model_request_started",
  "token_delta",
  "model_request_completed",
  "tool_call_requested",
  "tool_call_permission_evaluated",
  "approval_requested",
  "approval_resolved",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "assistant_message_created",
  "turn_complete",
  "run_completed",
  "run_failed"
] as const;

export type RuntimeEventType = (typeof runtimeEventTypes)[number];

export interface RuntimeEventBase {
  type: RuntimeEventType;
  eventId: string;
  runId: string;
  sessionId?: string;
  timestamp: string;
}

export interface RunStartedEvent extends RuntimeEventBase {
  type: "run_started";
  userMessage: string;
}

export interface ContextAssembledEvent extends RuntimeEventBase {
  type: "context_assembled";
  messageCount: number;
  systemInstructionIncluded: boolean;
}

export interface CompactionTriggeredEvent extends RuntimeEventBase {
  type: "compaction_triggered";
  messagesBefore: number;
  messagesAfter: number;
  summary: string;
}

export interface MemoryFlushTriggeredEvent extends RuntimeEventBase {
  type: "memory_flush_triggered";
  /** True if the silent flush model call was executed; false when skipped (disabled, or compaction not predicted). */
  executed: boolean;
  /** Names of tools the model invoked during the flush turn (if any). */
  toolsInvoked: string[];
  /** Reason when not executed: "disabled" | "not_needed" | "model_error". */
  reason?: string;
}

export interface TodosUpdatedEvent extends RuntimeEventBase {
  type: "todos_updated";
  todos: TodoItem[];
}

export interface PlanningStallDetectedEvent extends RuntimeEventBase {
  type: "planning_stall_detected";
  stallCount: number;
  maxRetries: number;
}

export interface ModelRequestStartedEvent extends RuntimeEventBase {
  type: "model_request_started";
  provider: string;
}

export interface TokenDeltaEvent extends RuntimeEventBase {
  type: "token_delta";
  delta: string;
}

export interface ModelRequestCompletedEvent extends RuntimeEventBase {
  type: "model_request_completed";
  provider: string;
}

export interface AssistantMessageCreatedEvent extends RuntimeEventBase {
  type: "assistant_message_created";
  message: {
    role: "assistant";
    content: string;
  };
}

export interface ToolCallRequestedEvent extends RuntimeEventBase {
  type: "tool_call_requested";
  call: ModelToolCall;
}

export interface ToolCallPermissionEvaluatedEvent extends RuntimeEventBase {
  type: "tool_call_permission_evaluated";
  callId: string;
  toolName: string;
  decision: PermissionDecision;
}

export interface ApprovalRequestedEvent extends RuntimeEventBase {
  type: "approval_requested";
  callId: string;
  toolName: string;
  decision: PermissionDecision;
}

export interface ApprovalResolution {
  approved: boolean;
  reason: string;
}

export interface ApprovalResolvedEvent extends RuntimeEventBase {
  type: "approval_resolved";
  callId: string;
  toolName: string;
  resolution: ApprovalResolution;
}

export interface ToolStartedEvent extends RuntimeEventBase {
  type: "tool_started";
  callId: string;
  toolName: string;
}

export interface ToolCompletedEvent extends RuntimeEventBase {
  type: "tool_completed";
  callId: string;
  toolName: string;
  result: ToolExecutionResult;
}

export interface ToolFailedEvent extends RuntimeEventBase {
  type: "tool_failed";
  callId: string;
  toolName: string;
  error: {
    message: string;
  };
}

export interface RunCompletedEvent extends RuntimeEventBase {
  type: "run_completed";
}

export interface RunFailedEvent extends RuntimeEventBase {
  type: "run_failed";
  error: {
    message: string;
    recoverable: boolean;
  };
}

export interface TurnCompleteEvent extends RuntimeEventBase {
  type: "turn_complete";
  messages: ModelMessage[];
}

export type RuntimeEvent =
  | RunStartedEvent
  | ContextAssembledEvent
  | CompactionTriggeredEvent
  | MemoryFlushTriggeredEvent
  | TodosUpdatedEvent
  | PlanningStallDetectedEvent
  | ModelRequestStartedEvent
  | TokenDeltaEvent
  | ModelRequestCompletedEvent
  | ToolCallRequestedEvent
  | ToolCallPermissionEvaluatedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | AssistantMessageCreatedEvent
  | TurnCompleteEvent
  | RunCompletedEvent
  | RunFailedEvent;

type RuntimeEventInput = RuntimeEvent extends infer TEvent
  ? TEvent extends RuntimeEvent
    ? Omit<TEvent, "eventId" | "timestamp">
    : never
  : never;

export function createRuntimeEvent<TEvent extends RuntimeEvent>(event: TEvent): TEvent {
  return event;
}

export function isTerminalRuntimeEvent(event: RuntimeEvent): event is RunCompletedEvent | RunFailedEvent {
  return event.type === "run_completed" || event.type === "run_failed";
}

export interface RuntimeTraceQuery {
  limit?: number;
}

export interface RuntimeTraceStore {
  append(event: RuntimeEvent): Promise<void>;
  listRecent(query?: RuntimeTraceQuery): Promise<RuntimeEvent[]>;
  listByRun(runId: string): Promise<RuntimeEvent[]>;
}

export class InMemoryRuntimeTraceStore implements RuntimeTraceStore {
  readonly #events: RuntimeEvent[] = [];

  async append(event: RuntimeEvent): Promise<void> {
    this.#events.push(event);
  }

  async listRecent(query: RuntimeTraceQuery = {}): Promise<RuntimeEvent[]> {
    const events = query.limit === undefined ? this.#events : this.#events.slice(-query.limit);
    return [...events];
  }

  async listByRun(runId: string): Promise<RuntimeEvent[]> {
    return this.#events.filter((event) => event.runId === runId);
  }
}

export interface AgentRuntimeInput {
  sessionId?: string;
  recentMessages?: ModelMessage[];
  message: string;
  signal?: AbortSignal;
}

export interface ApprovalRequest {
  call: ModelToolCall;
  decision: PermissionDecision;
}

export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<ApprovalResolution>;
}

export type ExecutionContract = "default" | "strict-agentic";

export interface AgentHooks {
  beforeTurn?: (input: AgentRuntimeInput) => Promise<void>;
  afterTurn?: (events: RuntimeEvent[]) => Promise<void>;
  beforeToolCall?: (call: ModelToolCall) => Promise<void | "abort">;
  afterToolCall?: (call: ModelToolCall, result: ToolExecutionResult) => Promise<void>;
  onCompaction?: (messageBefore: number, messageAfter: number) => Promise<void>;
}

export interface AgentRuntimeDependencies {
  contextAssembler?: ContextAssembler;
  modelProvider: ModelProvider;
  permissionPolicy?: PermissionPolicy;
  approvalResolver?: ApprovalResolver;
  tools?: ExecutableTool[];
  skillIndex?: ContextSkillSummary[];
  maxSteps?: number;
  maxPlanningStallRetries?: number;
  systemInstruction?: string;
  runtime?: ContextRuntimeMetadata;
  preferStreaming?: boolean;
  compaction?: Partial<CompactionOptions>;
  promptMode?: PromptMode;
  hooks?: AgentHooks;
  executionContract?: ExecutionContract;
  /** Phase 12: push-completion mailbox. When provided alongside an `input.sessionId`, runTurn drains pending announcements addressed to that session id at the start of every turn. */
  taskStore?: AsyncTaskStore;
  /** Phase 12: this runtime's spawn depth — 0 for top-level user runs, parent depth + 1 for spawned children. Threaded to tool execution context so spawn tools can stamp the next level. */
  depth?: number;
  createRunId?: () => string;
  createEventId?: () => string;
  now?: () => string;
}

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_PLANNING_STALL_RETRIES = 2;

const DEFAULT_PERMISSION_GUIDANCE =
  "Low-risk actions run automatically. Medium and high-risk actions require approval. Blocked actions are never permitted.";

const PLANNING_ONLY_RETRY_INSTRUCTION =
  "Do not restate the plan. Act now: take the first concrete tool action you can.";

// ── Planning stall detection (OpenClaw-aligned) ──────────────────────────────
// Promise language — explicit future-action commitments.
const PLAN_PROMISE_RE =
  /\b(?:i(?:'ll| will)|let me|i(?:'m| am)\s+going to|first[, ]+i(?:'ll| will)|next[, ]+i(?:'ll| will)|i can do that)\b/i;

// Completion language — presence of any of these words means the model already
// acted or is reporting results. Takes priority: if found, never a planning stall.
const PLAN_COMPLETION_RE =
  /\b(?:done|finished|implemented|updated|fixed|changed|ran|verified|found|here(?:'s| is) what|blocked by|the blocker is)\b/i;

// Explicit plan-section headings (colon required; "steps taken" is a result header).
const PLAN_HEADING_RE = /^(?:plan|steps?|next steps?)\s*:/im;

// Bullet / numbered list — a planning signal only when combined with promise language.
const PLAN_BULLET_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/u;

// Action verbs required when no structured plan format is present — prevents
// vague filler phrases like "let me think" from triggering the stall detector.
const PLAN_ACTION_VERB_RE =
  /\b(?:inspect|investigate|check|look(?:\s+into|\s+at)?|read|search|find|debug|fix|patch|update|change|edit|write|implement|run|test|verify|review|analy(?:s|z)e|summari(?:s|z)e|explain|answer|show|share|report|prepare|refactor|deploy)\b/i;

// Responses longer than this are almost certainly result reports, not plans.
const PLAN_MAX_CHARS = 700;

export class AgentRuntime {
  readonly #contextAssembler: ContextAssembler;
  readonly #modelProvider: ModelProvider;
  readonly #permissionPolicy: PermissionPolicy;
  readonly #approvalResolver: ApprovalResolver | undefined;
  readonly #tools: Map<string, ExecutableTool>;
  readonly #skillIndex: ContextSkillSummary[];
  readonly #maxSteps: number;
  readonly #maxPlanningStallRetries: number;
  readonly #systemInstruction: string;
  readonly #runtime: ContextRuntimeMetadata | undefined;
  readonly #preferStreaming: boolean;
  readonly #compaction: Partial<CompactionOptions> | undefined;
  readonly #promptMode: PromptMode | undefined;
  readonly #hooks: AgentHooks | undefined;
  readonly #taskStore: AsyncTaskStore | undefined;
  readonly #depth: number;
  readonly #executionContract: ExecutionContract;
  readonly #createRunId: () => string;
  readonly #createEventId: () => string;
  readonly #now: () => string;
  #currentTodos: TodoItem[] = [];

  constructor(dependencies: AgentRuntimeDependencies) {
    this.#contextAssembler = dependencies.contextAssembler ?? new MinimalContextAssembler();
    this.#modelProvider = dependencies.modelProvider;
    this.#permissionPolicy = dependencies.permissionPolicy ?? new DefaultPermissionPolicy();
    this.#approvalResolver = dependencies.approvalResolver;
    this.#maxSteps = dependencies.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#executionContract = dependencies.executionContract ?? "default";
    this.#maxPlanningStallRetries = dependencies.executionContract === "strict-agentic"
      ? (dependencies.maxPlanningStallRetries ?? 3)
      : (dependencies.maxPlanningStallRetries ?? DEFAULT_MAX_PLANNING_STALL_RETRIES);
    this.#skillIndex = dependencies.skillIndex ?? [];
    const baseInstruction = dependencies.systemInstruction ?? "";
    this.#systemInstruction = dependencies.executionContract === "strict-agentic"
      ? `${baseInstruction}\n\nExecution contract: strict-agentic. Act immediately. Do not narrate plans. Call tools now.`
      : baseInstruction;
    this.#runtime = dependencies.runtime;
    this.#preferStreaming = dependencies.preferStreaming ?? false;
    this.#compaction = dependencies.compaction;
    this.#promptMode = dependencies.promptMode;
    this.#hooks = dependencies.hooks;
    this.#taskStore = dependencies.taskStore;
    this.#depth = dependencies.depth ?? 0;
    this.#createRunId = dependencies.createRunId ?? randomId("run");
    this.#createEventId = dependencies.createEventId ?? randomId("evt");
    this.#now = dependencies.now ?? (() => new Date().toISOString());

    // update_todos is always available; the callback updates #currentTodos so
    // the runtime can emit todos_updated after the tool call batch completes.
    const updateTodos = createUpdateTodosTool((todos) => { this.#currentTodos = todos; });
    const userTools = dependencies.tools ?? [];
    this.#tools = new Map([updateTodos, ...userTools].map((tool) => [tool.name, tool]));
  }

  async *runTurn(input: AgentRuntimeInput): AsyncIterable<RuntimeEvent> {
    const runId = this.#createRunId();
    const base = input.sessionId ? { runId, sessionId: input.sessionId } : { runId };
    const collectedEvents: RuntimeEvent[] = [];

    try {
      // beforeTurn hook — errors must not fail the run
      if (this.#hooks?.beforeTurn !== undefined) {
        try {
          await this.#hooks.beforeTurn(input);
        } catch (err) {
          if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
            console.warn("[AgentRuntime] beforeTurn hook threw:", err);
          }
        }
      }

      const emitAndCollect = (event: RuntimeEvent): RuntimeEvent => {
        collectedEvents.push(event);
        return event;
      };

      yield emitAndCollect(this.#event({ ...base, type: "run_started", userMessage: input.message }));

      // Phase 12: drain pending sub-agent completion announcements addressed to this session.
      // Each drained announcement is injected as a system message before context assembly so the
      // model sees its children's results at the top of the turn. The store atomically clears the
      // mailbox entries during the drain, guaranteeing exactly-once delivery.
      const announcementMessages: ModelMessage[] = [];
      if (this.#taskStore !== undefined && input.sessionId !== undefined) {
        try {
          const announcements = await this.#taskStore.drainPendingForParent(input.sessionId);
          for (const a of announcements) {
            announcementMessages.push({
              role: "system",
              content: formatSubagentAnnouncement(a)
            });
          }
        } catch (err) {
          if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
            console.warn("[AgentRuntime] drainPendingForParent failed:", err);
          }
        }
      }
      const effectiveRecentMessages = announcementMessages.length > 0
        ? [...announcementMessages, ...(input.recentMessages ?? [])]
        : input.recentMessages;

      const contextToolSummaries = this.#buildContextToolSummaries();
      const assembled = await this.#contextAssembler.assemble({
        systemInstruction: this.#systemInstruction,
        ...(this.#runtime ? { runtime: this.#runtime } : {}),
        ...(contextToolSummaries.length > 0 ? { tools: contextToolSummaries } : {}),
        permissionGuidance: DEFAULT_PERMISSION_GUIDANCE,
        ...(this.#skillIndex.length > 0 ? { skillIndex: this.#skillIndex } : {}),
        ...(effectiveRecentMessages ? { recentMessages: effectiveRecentMessages } : {}),
        ...(this.#promptMode !== undefined ? { promptMode: this.#promptMode } : {}),
        userMessage: input.message
      });

      yield emitAndCollect(this.#event({
        ...base,
        type: "context_assembled",
        messageCount: assembled.modelInput.messages.length,
        systemInstructionIncluded: assembled.report.includedSections.includes("identity")
      }));

      const toolDefinitions = this.#buildToolDefinitions();
      let messages = assembled.modelInput.messages;
      let steps = 0;
      let stallCount = 0;
      // True once any non-update_todos tool has executed in this turn.
      // Mirrors OpenClaw's hasNonPlanToolActivity guard: if real work was done,
      // a subsequent message is reporting results, not planning — skip stall detection.
      let hadRealToolCallThisTurn = false;
      // Text the model generated alongside a tool call in the same response.
      // Carried forward so it can be committed as the turn's assistant text when
      // the final text-only response is empty (model had nothing to add after the tool).
      let lastToolCallText = "";
      this.#currentTodos = [];

      // Track all new messages for this turn (user + tool calls + tool results + final assistant)
      const turnNewMessages: ModelMessage[] = [];
      // Add the user message (last message in assembled.modelInput.messages)
      const userMsg = assembled.modelInput.messages.at(-1);
      if (userMsg) turnNewMessages.push({ ...userMsg });

      while (steps < this.#maxSteps) {
        if (input.signal?.aborted) {
          yield emitAndCollect(this.#event({ ...base, type: "run_failed", error: { message: "Aborted by user.", recoverable: false } }));
          await this.#callAfterTurn(collectedEvents);
          return;
        }

        if (this.#compaction !== undefined) {
          // Phase 13b Step 5: pre-compaction memory flush. Before compactMessages
          // potentially discards old turns, give the agent one silent turn to
          // write durable facts via append_daily_memory. Triggers only when:
          //  - memoryFlush.enabled is not explicitly false (default true)
          //  - compaction would actually run (token/message threshold exceeded)
          const opts = { ...DEFAULT_COMPACTION_OPTIONS, ...this.#compaction };
          const flushEnabled = opts.memoryFlush?.enabled !== false;
          const willCompact =
            estimateMessageTokens(messages) > opts.maxTokens ||
            messages.length > opts.maxMessages;

          if (willCompact && flushEnabled) {
            const flushResult = await this.#performMemoryFlush(messages, opts.memoryFlush?.prompt ?? DEFAULT_MEMORY_FLUSH_PROMPT);
            yield emitAndCollect(this.#event({ ...base, type: "memory_flush_triggered", executed: flushResult.executed, toolsInvoked: flushResult.toolsInvoked, ...(flushResult.reason !== undefined ? { reason: flushResult.reason } : {}) }));
          } else if (!flushEnabled) {
            yield emitAndCollect(this.#event({ ...base, type: "memory_flush_triggered", executed: false, toolsInvoked: [], reason: "disabled" }));
          }

          const before = messages.length;
          messages = await compactMessages(messages, this.#modelProvider, this.#compaction);
          const after = messages.length;
          if (after < before) {
            // Extract summary from the compacted messages
            const summaryMsg = messages.find(
              (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("Conversation summary:\n")
            );
            const summary = summaryMsg && typeof summaryMsg.content === "string"
              ? summaryMsg.content.slice("Conversation summary:\n".length)
              : "";
            yield emitAndCollect(this.#event({ ...base, type: "compaction_triggered", messagesBefore: before, messagesAfter: after, summary }));
          }
          if (this.#hooks?.onCompaction !== undefined) {
            try {
              await this.#hooks.onCompaction(before, after);
            } catch (err) {
              if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
                console.warn("[AgentRuntime] onCompaction hook threw:", err);
              }
            }
          }
        }

        yield emitAndCollect(this.#event({ ...base, type: "model_request_started", provider: "configured" }));

        const modelInput = {
          messages,
          ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
          ...(assembled.modelInput.options !== undefined ? { options: assembled.modelInput.options } : {})
        };

        let output: ModelOutput;

        if (this.#preferStreaming && isStreamingProvider(this.#modelProvider)) {
          let textContent = "";
          let streamedToolCalls: ModelToolCall[] | undefined;
          let streamedToolCallText = "";
          let streamedUsage: ModelUsage | undefined;
          let streamError: { message: string; recoverable: boolean; category: string } | undefined;

          for await (const streamEvent of this.#modelProvider.generateStream(modelInput)) {
            if (input.signal?.aborted) break;
            if (streamEvent.type === "token_delta") {
              yield emitAndCollect(this.#event({ ...base, type: "token_delta", delta: streamEvent.delta }));
            } else if (streamEvent.type === "message_done") {
              textContent = streamEvent.content;
              streamedUsage = streamEvent.usage;
            } else if (streamEvent.type === "tool_calls") {
              streamedToolCalls = streamEvent.calls;
              streamedToolCallText = streamEvent.text ?? "";
              streamedUsage = streamEvent.usage;
            } else if (streamEvent.type === "error") {
              streamError = { category: streamEvent.category, message: streamEvent.message, recoverable: streamEvent.recoverable };
            }
          }

          if (streamError !== undefined) {
            output = { type: "error", category: streamError.category as never, message: streamError.message, recoverable: streamError.recoverable };
          } else if (streamedToolCalls !== undefined) {
            output = { type: "tool_calls", calls: streamedToolCalls, ...(streamedToolCallText ? { text: streamedToolCallText } : {}), ...(streamedUsage !== undefined ? { usage: streamedUsage } : {}) };
          } else {
            output = { type: "message", content: textContent, ...(streamedUsage !== undefined ? { usage: streamedUsage } : {}) };
          }
        } else {
          output = await this.#modelProvider.generate(modelInput);
        }

        yield emitAndCollect(this.#event({ ...base, type: "model_request_completed", provider: "configured" }));

        steps++;

        if (output.type === "error") {
          const ev = emitAndCollect(this.#event({ ...base, type: "run_failed", error: { message: output.message, recoverable: output.recoverable } }));
          yield ev;
          await this.#callAfterTurn(collectedEvents);
          return;
        }

        if (output.type === "message") {
          // Detect planning-only turns (model narrates a plan without taking action).
          // Guards: actionable tools must exist AND no real tool was called this turn.
          // The second guard (hadRealToolCallThisTurn) aligns with OpenClaw's
          // hasNonPlanToolActivity check: if the model already did real work, the
          // final message is reporting results, not a planning stall.
          const hasActionableTools = [...this.#tools.keys()].some((n) => n !== "update_todos");
          if (hasActionableTools && !hadRealToolCallThisTurn && isPlanningOnly(output.content)) {
            stallCount++;
            yield emitAndCollect(this.#event({ ...base, type: "planning_stall_detected", stallCount, maxRetries: this.#maxPlanningStallRetries }));

            if (stallCount >= this.#maxPlanningStallRetries) {
              const ev = emitAndCollect(this.#event({ ...base, type: "run_failed", error: { message: "Agent stopped after repeated plan-only turns without taking action.", recoverable: false } }));
              yield ev;
              await this.#callAfterTurn(collectedEvents);
              return;
            }

            messages = [
              ...messages,
              { role: "assistant", content: output.content },
              { role: "user", content: PLANNING_ONLY_RETRY_INSTRUCTION }
            ];
            continue;
          }

          stallCount = 0;
          if (output.content !== "") {
            // Model produced a final text reply — commit it as the canonical assistant turn.
            turnNewMessages.push({ role: "assistant", content: output.content });
            yield emitAndCollect(this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: output.content } }));
          } else if (lastToolCallText !== "") {
            // Final reply is empty but the model narrated text alongside an earlier tool
            // call in the same response. Surface that text as the assistant turn so the
            // UI can display it. The text is already stored in the tool-call assistant
            // message content, so we don't push a redundant entry to turnNewMessages.
            yield emitAndCollect(this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: lastToolCallText } }));
          }
          yield emitAndCollect(this.#event({ ...base, type: "turn_complete", messages: [...turnNewMessages] }));
          const completedEv = emitAndCollect(this.#event({ ...base, type: "run_completed" }));
          yield completedEv;
          await this.#callAfterTurn(collectedEvents);
          return;
        }

        // type === "tool_calls"
        stallCount = 0;
        if (output.calls.some((c) => c.name !== "update_todos")) {
          hadRealToolCallThisTurn = true;
        }
        if (output.text) {
          lastToolCallText = output.text;
        }
        const assistantToolCallMsg: ModelMessage = { role: "assistant", content: output.text ?? null, toolCalls: output.calls };
        messages = [...messages, assistantToolCallMsg];
        turnNewMessages.push({ ...assistantToolCallMsg });

        const toolResultMessages: ModelMessage[] = [];
        let hardTerminate = false;
        let terminationError = "";

        for (const call of output.calls) {
          yield emitAndCollect(this.#event({ ...base, type: "tool_call_requested", call }));

          const tool = this.#tools.get(call.name);
          if (tool === undefined) {
            const errorMessage = `Tool "${call.name}" is not registered.`;
            yield emitAndCollect(this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: errorMessage } }));
            const errResultMsg: ModelMessage = { role: "tool", toolCallId: call.id, content: `Error: ${errorMessage}` };
            toolResultMessages.push(errResultMsg);
            turnNewMessages.push({ ...errResultMsg });
            continue;
          }

          const decision = this.#permissionPolicy.evaluate({
            mode: normalizeAutonomyMode(this.#runtime?.mode),
            action: createToolPermissionAction(call, tool.risk)
          });

          yield emitAndCollect(this.#event({ ...base, type: "tool_call_permission_evaluated", callId: call.id, toolName: call.name, decision }));

          if (decision.decision === "deny") {
            hardTerminate = true;
            terminationError = `Tool call ${call.name} was denied.`;
            break;
          }

          if (decision.decision === "ask") {
            yield emitAndCollect(this.#event({ ...base, type: "approval_requested", callId: call.id, toolName: call.name, decision }));

            const resolution =
              this.#approvalResolver === undefined
                ? { approved: false, reason: "No approval resolver was configured." }
                : await this.#approvalResolver.resolve({ call, decision });

            yield emitAndCollect(this.#event({ ...base, type: "approval_resolved", callId: call.id, toolName: call.name, resolution }));

            if (!resolution.approved) {
              hardTerminate = true;
              terminationError = `Tool call ${call.name} was denied.`;
              break;
            }
          }

          // beforeToolCall hook
          if (this.#hooks?.beforeToolCall !== undefined) {
            let hookResult: void | "abort" = undefined;
            try {
              hookResult = await this.#hooks.beforeToolCall(call);
            } catch (err) {
              if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
                console.warn("[AgentRuntime] beforeToolCall hook threw:", err);
              }
            }
            if (hookResult === "abort") {
              const abortMessage = "Tool call aborted by hook.";
              yield emitAndCollect(this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: abortMessage } }));
              const abortResultMsg: ModelMessage = { role: "tool", toolCallId: call.id, content: `Error: ${abortMessage}` };
              toolResultMessages.push(abortResultMsg);
              turnNewMessages.push({ ...abortResultMsg });
              continue;
            }
          }

          yield emitAndCollect(this.#event({ ...base, type: "tool_started", callId: call.id, toolName: call.name }));

          let result: Awaited<ReturnType<typeof tool.execute>>;
          try {
            // Phase 12: thread parent context into tool execution so spawn tools
            // can request a fork transcript and stamp the next spawn depth.
            // parentRecentMessages: everything assembled for the model this turn.
            //   This is the most accurate snapshot of "what the parent agent knows now".
            // parentSessionId: forwarded so child session keys can be composed.
            // depth: child runs at this+1, so spawn_subagent* read it via execContext.
            const execContext: ToolExecutionContext = {
              workspaceRoot: this.#runtime?.workspace ?? process.cwd(),
              parentRecentMessages: messages.map((m) => ({ role: m.role, content: m.content })),
              ...(input.sessionId !== undefined ? { parentSessionId: input.sessionId } : {}),
              depth: this.#depth
            };
            result = await tool.execute(call.input, execContext);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error.";
            yield emitAndCollect(this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: errorMessage } }));
            const execErrMsg: ModelMessage = { role: "tool", toolCallId: call.id, content: `Error: ${errorMessage}` };
            toolResultMessages.push(execErrMsg);
            turnNewMessages.push({ ...execErrMsg });
            continue;
          }

          yield emitAndCollect(this.#event({ ...base, type: "tool_completed", callId: call.id, toolName: call.name, result }));
          const toolSuccessMsg: ModelMessage = { role: "tool", toolCallId: call.id, content: JSON.stringify(result) };
          toolResultMessages.push(toolSuccessMsg);
          turnNewMessages.push({ ...toolSuccessMsg });

          // afterToolCall hook
          if (this.#hooks?.afterToolCall !== undefined) {
            try {
              await this.#hooks.afterToolCall(call, result);
            } catch (err) {
              if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
                console.warn("[AgentRuntime] afterToolCall hook threw:", err);
              }
            }
          }
        }

        if (hardTerminate) {
          const ev = emitAndCollect(this.#event({ ...base, type: "run_failed", error: { message: terminationError, recoverable: false } }));
          yield ev;
          await this.#callAfterTurn(collectedEvents);
          return;
        }

        // Emit todos_updated if update_todos was called this batch.
        if (output.calls.some((c) => c.name === "update_todos")) {
          yield emitAndCollect(this.#event({ ...base, type: "todos_updated", todos: [...this.#currentTodos] }));
        }

        messages = [...messages, ...toolResultMessages];
      }

      const stepLimitEv = emitAndCollect(this.#event({ ...base, type: "run_failed", error: { message: `Agent loop reached the step limit of ${this.#maxSteps}.`, recoverable: false } }));
      yield stepLimitEv;
      await this.#callAfterTurn(collectedEvents);
    } finally {
      // In-process per-session serialization is now handled by @vole/lanes (session lane,
      // concurrency 1) inside GatewayCore. The runtime no longer holds any mutex here.
    }
  }

  /**
   * Phase 13b Step 5: pre-compaction memory flush silent turn.
   *
   * Calls the model once with the existing conversation plus a system message
   * nudging it to record durable facts via append_daily_memory. Tool calls in
   * the model's response are executed directly through the tool's `execute`
   * function. No runtime events fire for individual tool calls during this
   * silent turn — only the wrapping memory_flush_triggered event is emitted by
   * the caller after this resolves. The user-visible assistant text (if any)
   * is dropped.
   *
   * Returns:
   *  - executed: true when the model call completed (with or without tool calls).
   *  - toolsInvoked: names of memory-write tools actually run.
   *  - reason: "model_error" when the model call threw or errored out.
   */
  async #performMemoryFlush(
    messages: ModelMessage[],
    prompt: string
  ): Promise<{ executed: boolean; toolsInvoked: string[]; reason?: string }> {
    const toolDefinitions = this.#buildToolDefinitions();
    const flushMessages: ModelMessage[] = [...messages, { role: "system", content: prompt }];

    let output: ModelOutput;
    try {
      output = await this.#modelProvider.generate({
        messages: flushMessages,
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {})
      });
    } catch {
      return { executed: false, toolsInvoked: [], reason: "model_error" };
    }

    if (output.type === "error") {
      return { executed: false, toolsInvoked: [], reason: "model_error" };
    }
    if (output.type !== "tool_calls") {
      return { executed: true, toolsInvoked: [] };
    }

    const invoked: string[] = [];
    const execContext: ToolExecutionContext = {
      workspaceRoot: this.#runtime?.workspace ?? process.cwd(),
      parentRecentMessages: messages.map((m) => ({ role: m.role, content: m.content })),
      depth: this.#depth
    };
    for (const call of output.calls) {
      const tool = this.#tools.get(call.name);
      if (tool === undefined) continue;
      // Conservative scope: only run reversible memory-write tools during the
      // silent flush. High-risk and blocked tools are dropped to avoid the
      // model performing destructive work without the normal permission UI.
      if (tool.risk === "high" || tool.risk === "blocked") continue;
      try {
        await tool.execute(call.input, execContext);
        invoked.push(call.name);
      } catch {
        // Swallow errors — the flush is best-effort and must not stall the
        // upcoming compaction or the user-visible turn loop.
      }
    }
    return { executed: true, toolsInvoked: invoked };
  }

  async #callAfterTurn(events: RuntimeEvent[]): Promise<void> {
    if (this.#hooks?.afterTurn === undefined) return;
    try {
      await this.#hooks.afterTurn(events);
    } catch (err) {
      if (typeof process !== "undefined" && process.env["NODE_ENV"] !== "production") {
        console.warn("[AgentRuntime] afterTurn hook threw:", err);
      }
    }
  }

  #buildContextToolSummaries(): ContextToolSummary[] {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk
    }));
  }

  #buildToolDefinitions(): ModelToolDefinition[] {
    return [...this.#tools.values()].map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  #event<TEvent extends RuntimeEventInput>(event: TEvent): RuntimeEvent {
    return createRuntimeEvent({
      ...event,
      eventId: this.#createEventId(),
      timestamp: this.#now()
    } as RuntimeEvent);
  }
}

function randomId(prefix: string): () => string {
  return () => `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Phase 12: format a push-completion announcement as a `system` role message.
 * The structured layout mirrors OpenClaw's announcement convention so the model
 * can recognise sub-agent completions reliably across providers.
 */
export function formatSubagentAnnouncement(a: AsyncPendingAnnouncement): string {
  const lines = [
    `[subagent #${a.taskId} ${a.status}]`,
    `goal: ${a.goal}`,
    `status: ${a.status}`
  ];
  if (a.terminalSummary !== undefined && a.terminalSummary.length > 0) {
    lines.push(`result: ${a.terminalSummary}`);
  }
  lines.push(`completedAt: ${a.completedAt}`);
  return lines.join("\n");
}

function createToolPermissionAction(call: ModelToolCall, risk: PermissionRiskLevel): {
  kind: "tool";
  name: string;
  summary: string;
  risk: PermissionRiskLevel;
} {
  return {
    kind: "tool",
    name: call.name,
    summary: `Model requested tool ${call.name}.`,
    risk
  };
}

function normalizeAutonomyMode(mode: string | undefined): AutonomyMode {
  return mode === "observe" || mode === "auto" ? mode : "confirm";
}

// True when the text has the structure of a written-out plan:
//   (heading + promise language)  OR  (≥2 bullet lines + promise language)
function hasStructuredPlanFormat(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const bulletCount = lines.filter((l) => PLAN_BULLET_RE.test(l)).length;
  const hasPromise = lines.some((l) => PLAN_PROMISE_RE.test(l));
  const hasHeading = PLAN_HEADING_RE.test(lines[0] ?? "");
  return (hasHeading && hasPromise) || (bulletCount >= 2 && hasPromise);
}

function isPlanningOnly(content: string): boolean {
  const text = content.trim();
  // Empty, long (likely a result report), or contains code blocks → never a stall.
  if (!text || text.length > PLAN_MAX_CHARS || text.includes("```")) return false;
  // Completion language means the model already acted or is reporting results.
  if (PLAN_COMPLETION_RE.test(text)) return false;
  const hasStructured = hasStructuredPlanFormat(text);
  // Without structured plan format, require explicit promise language.
  if (!PLAN_PROMISE_RE.test(text) && !hasStructured) return false;
  // Without structured plan format, also require an action verb — prevents vague
  // filler ("let me think about this") from triggering the stall detector.
  if (!hasStructured && !PLAN_ACTION_VERB_RE.test(text)) return false;
  return true;
}

export interface CreateAgentOptions {
  model: ModelProvider;
  systemInstruction?: string;
  tools?: ExecutableTool[];
  permissions?: PermissionPolicy;
  approvalResolver?: ApprovalResolver;
  context?: ContextAssembler;
  compaction?: Partial<CompactionOptions>;
  maxSteps?: number;
  runtime?: ContextRuntimeMetadata;
  preferStreaming?: boolean;
  promptMode?: PromptMode;
  hooks?: AgentHooks;
  executionContract?: ExecutionContract;
  skillIndex?: ContextSkillSummary[];
  taskStore?: AsyncTaskStore;
}

export function createAgent(options: CreateAgentOptions): AgentRuntime {
  const deps: AgentRuntimeDependencies = { modelProvider: options.model };
  if (options.systemInstruction !== undefined) deps.systemInstruction = options.systemInstruction;
  if (options.context !== undefined) deps.contextAssembler = options.context;
  if (options.tools !== undefined) deps.tools = options.tools;
  if (options.permissions !== undefined) deps.permissionPolicy = options.permissions;
  if (options.approvalResolver !== undefined) deps.approvalResolver = options.approvalResolver;
  if (options.maxSteps !== undefined) deps.maxSteps = options.maxSteps;
  if (options.runtime !== undefined) deps.runtime = options.runtime;
  if (options.preferStreaming !== undefined) deps.preferStreaming = options.preferStreaming;
  if (options.compaction !== undefined) deps.compaction = options.compaction;
  if (options.promptMode !== undefined) deps.promptMode = options.promptMode;
  if (options.hooks !== undefined) deps.hooks = options.hooks;
  if (options.executionContract !== undefined) deps.executionContract = options.executionContract;
  if (options.skillIndex !== undefined) deps.skillIndex = options.skillIndex;
  if (options.taskStore !== undefined) deps.taskStore = options.taskStore;
  return new AgentRuntime(deps);
}

// Minimal pending-announcement shape needed by core; satisfied by
// @vole/taskflow's PendingAnnouncement.
export interface AsyncPendingAnnouncement {
  taskId: string;
  goal: string;
  status: string;
  terminalSummary?: string;
  completedAt: string;
}

// AsyncTaskStore is a duck-typed interface for storing async task records.
// Core uses this instead of importing @vole/taskflow to avoid coupling.
export interface AsyncTaskStore {
  create(record: { id: string; runtime: string; task: string; status: string; parentId?: string }): Promise<{ id: string }>;
  update(id: string, updates: { status?: string; terminalSummary?: string; pendingAnnouncement?: AsyncPendingAnnouncement; clearPendingAnnouncement?: boolean }): Promise<unknown>;
  get(id: string): Promise<{ id: string; status: string; terminalSummary?: string } | undefined>;
  /** Phase 12: atomically read and clear pending announcements addressed to the given parent task id. */
  drainPendingForParent(parentId: string): Promise<AsyncPendingAnnouncement[]>;
}

export interface AsyncSubagentOptions {
  taskStore?: AsyncTaskStore;
  parentTaskId?: string;
}

// Phase 12: factory options. The gateway / spawn tool populates these so the
// factory can build the child with the correct context, depth, and parent linkage.
export interface SubagentFactoryOptions {
  /** Context mode: "isolated" (default) starts with empty transcript; "fork" copies parent's recent messages. */
  contextMode?: "isolated" | "fork";
  /** Used when contextMode === "fork": the parent's recent messages to thread into the child's first turn. */
  parentMessages?: ReadonlyArray<{ role: string; content: string | null }>;
  /** The depth this child will run at (parent depth + 1). The factory uses this to strip further-spawning tools when depth >= maxSpawnDepth. */
  depth?: number;
  /** Parent's session id; the factory may use it to compose the child's session key. */
  parentSessionKey?: string;
}

// Convenience shape: a factory may return either an AgentRuntime directly or a
// runtime plus first-turn input fragments (e.g. recentMessages for fork mode).
export interface SubagentRuntimeHandle {
  runtime: AgentRuntime;
  /** Additional input to pass to the FIRST runTurn call (e.g. forked recentMessages). */
  firstTurnInput?: Partial<AgentRuntimeInput>;
}

// SubagentFactory creates a new AgentRuntime for a sub-agent goal.
// Backwards compatible: implementations may return either a bare AgentRuntime or a SubagentRuntimeHandle.
export interface SubagentFactory {
  create(goal: string, options?: SubagentFactoryOptions): AgentRuntime | SubagentRuntimeHandle;
}

function resolveSubagentHandle(result: AgentRuntime | SubagentRuntimeHandle): SubagentRuntimeHandle {
  if ((result as SubagentRuntimeHandle).runtime !== undefined) {
    return result as SubagentRuntimeHandle;
  }
  return { runtime: result as AgentRuntime };
}

// createSpawnSubagentAsyncTool returns an ExecutableTool that spawns a sub-agent asynchronously.
// Returns a taskId immediately without waiting for the sub-agent to complete.
export function createSpawnSubagentAsyncTool(
  factory: SubagentFactory,
  options?: AsyncSubagentOptions
): ExecutableTool {
  return {
    name: "spawn_subagent_async",
    description: "Spawn a sub-agent to handle a subtask asynchronously. Returns a taskId immediately; the sub-agent runs in the background. Use spawn_subagent for synchronous execution.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The complete goal for the sub-agent." },
        context: { type: "string", description: "Optional background context." },
        contextMode: { type: "string", enum: ["isolated", "fork"], description: "isolated (default): empty transcript. fork: copy parent's recent messages." }
      },
      required: ["goal"]
    },
    async execute(rawInput, execContext) {
      const input = rawInput as { goal: string; context?: string; contextMode?: "isolated" | "fork" };
      const taskId = `task_${crypto.randomUUID()}`;

      // Create a task record if store is available
      if (options?.taskStore !== undefined) {
        await options.taskStore.create({
          id: taskId,
          runtime: "subagent",
          task: input.goal,
          status: "queued",
          ...(options.parentTaskId !== undefined ? { parentId: options.parentTaskId } : {})
        });
      }

      // Fire and forget — run in background, tracking status transitions
      const message = input.context !== undefined ? `${input.goal}\n\nContext:\n${input.context}` : input.goal;
      const factoryOptions: SubagentFactoryOptions = {
        contextMode: input.contextMode ?? "isolated",
        depth: (execContext?.depth ?? 0) + 1,
        ...(execContext?.parentRecentMessages !== undefined ? { parentMessages: execContext.parentRecentMessages } : {}),
        ...(execContext?.parentSessionId !== undefined ? { parentSessionKey: execContext.parentSessionId } : {})
      };
      void (async () => {
        if (options?.taskStore !== undefined) {
          await options.taskStore.update(taskId, { status: "running" });
        }
        const handle = resolveSubagentHandle(factory.create(input.goal, factoryOptions));
        const subRuntime = handle.runtime;
        let assistantText = "";
        let failed = false;
        const firstInput: AgentRuntimeInput = {
          message,
          ...(handle.firstTurnInput ?? {})
        };
        for await (const event of subRuntime.runTurn(firstInput)) {
          if (event.type === "assistant_message_created") assistantText = event.message.content;
          if (event.type === "run_failed") failed = true;
        }
        if (options?.taskStore !== undefined) {
          const status = failed ? "failed" : "succeeded";
          // Phase 12 push completion: write pendingAnnouncement so the parent's next
          // turn drains it as a system message. Suppress when assistant text is the
          // silent token NO_REPLY (case-insensitive), matching the OpenClaw convention
          // for fire-and-forget background work.
          const isSilent = /^\s*no_reply\s*$/i.test(assistantText);
          const announcement = (options.parentTaskId !== undefined && !isSilent)
            ? {
                taskId,
                goal: input.goal,
                status,
                ...(assistantText.length > 0 ? { terminalSummary: assistantText } : {}),
                completedAt: new Date().toISOString()
              } satisfies AsyncPendingAnnouncement
            : undefined;
          await options.taskStore.update(taskId, {
            status,
            ...(assistantText.length > 0 ? { terminalSummary: assistantText } : {}),
            ...(announcement !== undefined ? { pendingAnnouncement: announcement } : {})
          });
        }
      })();

      const result: SpawnSubagentAsyncResult = { type: "spawn_subagent_async_result", taskId, status: "queued" };
      return result;
    }
  };
}

// createCheckSubagentTool returns an ExecutableTool that queries the status and result
// of an async sub-agent task by taskId. Use after spawn_subagent_async.
export function createCheckSubagentTool(taskStore: AsyncTaskStore): ExecutableTool {
  return {
    name: "check_subagent",
    description: "Check the status and result of an async sub-agent by taskId. Returns status (queued/running/succeeded/failed) and result when complete. Use after spawn_subagent_async.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The taskId returned by spawn_subagent_async." }
      },
      required: ["taskId"]
    },
    async execute(rawInput): Promise<CheckSubagentResult | { ok: false; error: { code: string; message: string } }> {
      const input = rawInput as { taskId?: unknown };
      const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
      if (taskId === "") {
        return { ok: false, error: { code: "invalid_input", message: "taskId is required." } };
      }
      const record = await taskStore.get(taskId);
      if (record === undefined) {
        return { ok: false, error: { code: "not_found", message: `No subagent task found with id "${taskId}".` } };
      }
      return {
        type: "check_subagent_result",
        taskId: record.id,
        status: record.status,
        result: record.terminalSummary
      };
    }
  };
}

// createSpawnSubagentTool returns an ExecutableTool that spawns a sub-agent.
// The tool lives in core (not tools) to avoid circular imports since
// AgentRuntime is defined here.
export function createSpawnSubagentTool(factory: SubagentFactory): ExecutableTool {
  return {
    name: "spawn_subagent",
    description: "Spawn a focused sub-agent to handle a complex subtask and return its result. Use when the current task requires a separate focused execution context.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The complete goal for the sub-agent." },
        context: { type: "string", description: "Optional background context to share." }
      },
      required: ["goal"]
    },
    async execute(rawInput, execContext): Promise<SpawnSubagentResult> {
      const input = rawInput as { goal: string; context?: string; contextMode?: "isolated" | "fork" };

      const factoryOptions: SubagentFactoryOptions = {
        contextMode: input.contextMode ?? "isolated",
        depth: (execContext?.depth ?? 0) + 1,
        ...(execContext?.parentRecentMessages !== undefined ? { parentMessages: execContext.parentRecentMessages } : {}),
        ...(execContext?.parentSessionId !== undefined ? { parentSessionKey: execContext.parentSessionId } : {})
      };
      const handle = resolveSubagentHandle(factory.create(input.goal, factoryOptions));
      const subRuntime = handle.runtime;
      let assistantText = "";
      let failed = false;
      let errorMsg = "";

      const firstInput: AgentRuntimeInput = {
        message: input.goal,
        ...(handle.firstTurnInput ?? {})
      };
      for await (const event of subRuntime.runTurn(firstInput)) {
        if (event.type === "assistant_message_created") {
          assistantText = event.message.content;
        }
        if (event.type === "run_failed") {
          failed = true;
          errorMsg = event.error.message;
        }
      }

      if (failed) {
        return { type: "spawn_subagent_result", ok: false, error: errorMsg };
      }
      return { type: "spawn_subagent_result", ok: true, result: assistantText };
    }
  };
}

// Phase 12: management surface for sub-agents. The tool reads from a control
// surface (typically wrapping a GatewayCore) plus the task store, so core does
// not depend on @vole/gateway directly.
export interface ActiveRunHandleSummary {
  runId: string;
  sessionKey: string;
  agentId: string;
  isSubagent: boolean;
  startedAt: string;
  parentSessionKey?: string;
}

export interface SubagentControlSurface {
  /** Return a snapshot of all currently active runs in the gateway. The tool
   * filters by parentSessionKey to expose only the caller's children. */
  listActiveRuns(): ActiveRunHandleSummary[];
  /** Cancel an active run by id. Returns true if such a run existed. */
  cancel(runId: string): boolean;
}

export interface CreateSubagentsToolOptions {
  control: SubagentControlSurface;
  taskStore?: AsyncTaskStore;
}

export type SubagentsToolCommand = "list" | "info" | "kill" | "log" | "steer" | "send";

export interface SubagentsToolResult {
  type: "subagents_result";
  command: SubagentsToolCommand;
  ok: boolean;
  /** Active children of the current session (list command). */
  children?: ActiveRunHandleSummary[];
  /** Task record for a single child (info command). */
  record?: { id: string; status: string; terminalSummary?: string };
  /** Run ids that were aborted (kill command). */
  stopped?: string[];
  /** Reason for failure or a deferred-feature note (log/steer/send). */
  message?: string;
}

export function createSubagentsTool(options: CreateSubagentsToolOptions): ExecutableTool {
  return {
    name: "subagents",
    description: "Inspect and control the parent agent's active sub-agents. Commands: list, info, kill, log (reserved), steer (reserved), send (reserved).",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["list", "info", "kill", "log", "steer", "send"], description: "Action to perform." },
        taskId: { type: "string", description: "Target run id (for info / kill / log / steer / send). Pass \"all\" to kill to stop every active child." },
        message: { type: "string", description: "Message body for steer / send (reserved)." }
      },
      required: ["command"]
    },
    async execute(rawInput, execContext): Promise<SubagentsToolResult> {
      const input = rawInput as { command: SubagentsToolCommand; taskId?: string; message?: string };
      const parentSessionKey = execContext?.parentSessionId;

      if (input.command === "list") {
        const active = options.control.listActiveRuns();
        const children = parentSessionKey !== undefined
          ? active.filter((r) => r.parentSessionKey === parentSessionKey)
          : active.filter((r) => r.isSubagent);
        return { type: "subagents_result", command: "list", ok: true, children };
      }

      if (input.command === "info") {
        if (input.taskId === undefined || input.taskId === "") {
          return { type: "subagents_result", command: "info", ok: false, message: "taskId is required for info." };
        }
        if (options.taskStore === undefined) {
          return { type: "subagents_result", command: "info", ok: false, message: "No task store configured." };
        }
        const record = await options.taskStore.get(input.taskId);
        if (record === undefined) {
          return { type: "subagents_result", command: "info", ok: false, message: `No task found with id "${input.taskId}".` };
        }
        return { type: "subagents_result", command: "info", ok: true, record };
      }

      if (input.command === "kill") {
        if (input.taskId === undefined || input.taskId === "") {
          return { type: "subagents_result", command: "kill", ok: false, message: "taskId is required (or pass \"all\")." };
        }
        const stopped: string[] = [];
        if (input.taskId === "all") {
          const active = options.control.listActiveRuns();
          const targets = parentSessionKey !== undefined
            ? active.filter((r) => r.parentSessionKey === parentSessionKey)
            : active.filter((r) => r.isSubagent);
          for (const r of targets) {
            if (options.control.cancel(r.runId)) {
              stopped.push(r.runId);
            }
          }
        } else if (options.control.cancel(input.taskId)) {
          stopped.push(input.taskId);
        }
        return { type: "subagents_result", command: "kill", ok: true, stopped };
      }

      // Reserved commands: surface a clear "not yet implemented" without failing.
      return {
        type: "subagents_result",
        command: input.command,
        ok: false,
        message: `Command "${input.command}" is reserved for a future phase.`
      };
    }
  };
}

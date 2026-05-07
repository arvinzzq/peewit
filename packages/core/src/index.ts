/**
 * INPUT: ContextAssembler, ModelProvider, PermissionPolicy, ApprovalResolver, tools, hooks, SessionMutex, ExecutionContract, maxSteps, runtime metadata, user turn input, recent messages.
 * OUTPUT: AgentRuntime, runtime events (turn_complete, compaction_triggered+summary, token_delta, todos_updated, planning_stall_detected, tool/permission/approval), SubagentFactory, spawn tools, AsyncTaskStore, trace store.
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
import { compactMessages } from "@vole/context";
import { isStreamingProvider } from "@vole/models";
import type { ModelMessage, ModelOutput, ModelProvider, ModelUsage, ModelToolCall, ModelToolDefinition } from "@vole/models";
import {
  DefaultPermissionPolicy,
  type AutonomyMode,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRiskLevel
} from "@vole/permissions";
import { createUpdateTodosTool, type ExecutableTool, type TodoItem, type ToolExecutionResult, type SpawnSubagentResult, type SpawnSubagentAsyncResult } from "@vole/tools";

export const corePackageName = "@vole/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
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
}

export interface ApprovalRequest {
  call: ModelToolCall;
  decision: PermissionDecision;
}

export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<ApprovalResolution>;
}

export type ExecutionContract = "default" | "strict-agentic";

export class SessionMutex {
  readonly #locks = new Map<string, Promise<void>>();

  async acquire(sessionId: string): Promise<() => void> {
    const existing = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = existing.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    this.#locks.set(sessionId, next);
    await existing;
    return () => {
      release();
      // Clean up if no more waiters
      if (this.#locks.get(sessionId) === next) {
        this.#locks.delete(sessionId);
      }
    };
  }
}

export interface AgentHooks {
  beforeTurn?: (input: AgentRuntimeInput) => Promise<void>;
  afterTurn?: (events: RuntimeEvent[]) => Promise<void>;
  beforeToolCall?: (call: ModelToolCall) => Promise<void | "abort">;
  afterToolCall?: (call: ModelToolCall, result: ToolExecutionResult) => Promise<void>;
  onCompaction?: (messageBefore: number, messageAfter: number) => Promise<void>;
}

export interface AgentRuntimeDependencies {
  contextAssembler: ContextAssembler;
  modelProvider: ModelProvider;
  permissionPolicy?: PermissionPolicy;
  approvalResolver?: ApprovalResolver;
  tools?: ExecutableTool[];
  skillIndex?: ContextSkillSummary[];
  maxSteps?: number;
  maxPlanningStallRetries?: number;
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  preferStreaming?: boolean;
  compaction?: Partial<CompactionOptions>;
  promptMode?: PromptMode;
  hooks?: AgentHooks;
  sessionMutex?: SessionMutex;
  executionContract?: ExecutionContract;
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
  readonly #sessionMutex: SessionMutex | undefined;
  readonly #executionContract: ExecutionContract;
  readonly #createRunId: () => string;
  readonly #createEventId: () => string;
  readonly #now: () => string;
  #currentTodos: TodoItem[] = [];

  constructor(dependencies: AgentRuntimeDependencies) {
    this.#contextAssembler = dependencies.contextAssembler;
    this.#modelProvider = dependencies.modelProvider;
    this.#permissionPolicy = dependencies.permissionPolicy ?? new DefaultPermissionPolicy();
    this.#approvalResolver = dependencies.approvalResolver;
    this.#maxSteps = dependencies.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#executionContract = dependencies.executionContract ?? "default";
    this.#maxPlanningStallRetries = dependencies.executionContract === "strict-agentic"
      ? (dependencies.maxPlanningStallRetries ?? 3)
      : (dependencies.maxPlanningStallRetries ?? DEFAULT_MAX_PLANNING_STALL_RETRIES);
    this.#skillIndex = dependencies.skillIndex ?? [];
    this.#systemInstruction = dependencies.executionContract === "strict-agentic"
      ? `${dependencies.systemInstruction}\n\nExecution contract: strict-agentic. Act immediately. Do not narrate plans. Call tools now.`
      : dependencies.systemInstruction;
    this.#runtime = dependencies.runtime;
    this.#preferStreaming = dependencies.preferStreaming ?? false;
    this.#compaction = dependencies.compaction;
    this.#promptMode = dependencies.promptMode;
    this.#hooks = dependencies.hooks;
    this.#sessionMutex = dependencies.sessionMutex;
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

    // Acquire session mutex if configured
    const release = this.#sessionMutex
      ? await this.#sessionMutex.acquire(input.sessionId ?? "global")
      : undefined;

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

      const contextToolSummaries = this.#buildContextToolSummaries();
      const assembled = await this.#contextAssembler.assemble({
        systemInstruction: this.#systemInstruction,
        ...(this.#runtime ? { runtime: this.#runtime } : {}),
        ...(contextToolSummaries.length > 0 ? { tools: contextToolSummaries } : {}),
        permissionGuidance: DEFAULT_PERMISSION_GUIDANCE,
        ...(this.#skillIndex.length > 0 ? { skillIndex: this.#skillIndex } : {}),
        ...(input.recentMessages ? { recentMessages: input.recentMessages } : {}),
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
      this.#currentTodos = [];

      // Track all new messages for this turn (user + tool calls + tool results + final assistant)
      const turnNewMessages: ModelMessage[] = [];
      // Add the user message (last message in assembled.modelInput.messages)
      const userMsg = assembled.modelInput.messages.at(-1);
      if (userMsg) turnNewMessages.push({ ...userMsg });

      while (steps < this.#maxSteps) {
        if (this.#compaction !== undefined) {
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
          let streamedUsage: ModelUsage | undefined;
          let streamError: { message: string; recoverable: boolean; category: string } | undefined;

          for await (const streamEvent of this.#modelProvider.generateStream(modelInput)) {
            if (streamEvent.type === "token_delta") {
              yield emitAndCollect(this.#event({ ...base, type: "token_delta", delta: streamEvent.delta }));
            } else if (streamEvent.type === "message_done") {
              textContent = streamEvent.content;
              streamedUsage = streamEvent.usage;
            } else if (streamEvent.type === "tool_calls") {
              streamedToolCalls = streamEvent.calls;
              streamedUsage = streamEvent.usage;
            } else if (streamEvent.type === "error") {
              streamError = { category: streamEvent.category, message: streamEvent.message, recoverable: streamEvent.recoverable };
            }
          }

          if (streamError !== undefined) {
            output = { type: "error", category: streamError.category as never, message: streamError.message, recoverable: streamError.recoverable };
          } else if (streamedToolCalls !== undefined) {
            output = { type: "tool_calls", calls: streamedToolCalls, ...(streamedUsage !== undefined ? { usage: streamedUsage } : {}) };
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
          // Track the final assistant message
          turnNewMessages.push({ role: "assistant", content: output.content });
          yield emitAndCollect(this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: output.content } }));
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
        const assistantToolCallMsg: ModelMessage = { role: "assistant", content: null, toolCalls: output.calls };
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
            result = await tool.execute(call.input, {
              workspaceRoot: this.#runtime?.workspace ?? process.cwd()
            });
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
      release?.();
    }
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

// AsyncTaskStore is a duck-typed interface for storing async task records.
// Core uses this instead of importing @vole/taskflow to avoid coupling.
export interface AsyncTaskStore {
  create(record: { id: string; runtime: string; task: string; status: string; parentId?: string }): Promise<{ id: string }>;
}

export interface AsyncSubagentOptions {
  taskStore?: AsyncTaskStore;
  parentTaskId?: string;
}

// SubagentFactory creates a new AgentRuntime for a sub-agent goal.
export interface SubagentFactory {
  create(goal: string): AgentRuntime;
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
        context: { type: "string", description: "Optional background context." }
      },
      required: ["goal"]
    },
    async execute(rawInput) {
      const input = rawInput as { goal: string; context?: string };
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

      // Fire and forget — run in background
      const message = input.context !== undefined ? `${input.goal}\n\nContext:\n${input.context}` : input.goal;
      void (async () => {
        const subRuntime = factory.create(input.goal);
        for await (const _event of subRuntime.runTurn({ message })) { /* consume */ }
      })();

      const result: SpawnSubagentAsyncResult = { type: "spawn_subagent_async_result", taskId, status: "queued" };
      return result;
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
    async execute(rawInput, _execContext): Promise<SpawnSubagentResult> {
      const input = rawInput as { goal: string; context?: string };

      const subRuntime = factory.create(input.goal);
      let assistantText = "";
      let failed = false;
      let errorMsg = "";

      for await (const event of subRuntime.runTurn({ message: input.goal })) {
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

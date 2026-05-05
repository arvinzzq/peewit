/**
 * INPUT: ContextAssembler, ModelProvider (optionally StreamingModelProvider), PermissionPolicy, optional ApprovalResolver, executable tools, maxSteps, maxPlanningStallRetries, runtime metadata, user turn input, and optional recent conversation messages.
 * OUTPUT: AgentRuntime, SubagentFactory interface, createSpawnSubagentTool, runtime event contracts (including token_delta for streaming), in-memory trace store, todos_updated event, planning_stall_detected event, tool-call request events, permission evaluation events, approval resolution events, and tool lifecycle events.
 * POS: Core runtime layer; coordinates a turn without owning adapters or vendor APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type {
  CompactionOptions,
  ContextAssembler,
  ContextRuntimeMetadata,
  ContextSkillSummary,
  ContextToolSummary
} from "@arvinclaw/context";
import { compactMessages } from "@arvinclaw/context";
import { isStreamingProvider } from "@arvinclaw/models";
import type { ModelMessage, ModelOutput, ModelProvider, ModelUsage, ModelToolCall, ModelToolDefinition } from "@arvinclaw/models";
import {
  DefaultPermissionPolicy,
  type AutonomyMode,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRiskLevel
} from "@arvinclaw/permissions";
import { createUpdateTodosTool, type ExecutableTool, type TodoItem, type ToolExecutionResult, type SpawnSubagentResult } from "@arvinclaw/tools";

export const corePackageName = "@arvinclaw/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
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

export type RuntimeEvent =
  | RunStartedEvent
  | ContextAssembledEvent
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

const PLAN_PROMISE_RE = /\b(I['']ll|let me|I'm going to|I will|I plan to)\b/i;
const PLAN_HEADING_RE = /^(plan|steps|approach|here['']s what I|my plan)[:\s]/im;
const PLAN_BULLET_RE = /^(\d+\.|[-*•])\s+\w/m;

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
    this.#maxPlanningStallRetries = dependencies.maxPlanningStallRetries ?? DEFAULT_MAX_PLANNING_STALL_RETRIES;
    this.#skillIndex = dependencies.skillIndex ?? [];
    this.#systemInstruction = dependencies.systemInstruction;
    this.#runtime = dependencies.runtime;
    this.#preferStreaming = dependencies.preferStreaming ?? false;
    this.#compaction = dependencies.compaction;
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

    yield this.#event({ ...base, type: "run_started", userMessage: input.message });

    const contextToolSummaries = this.#buildContextToolSummaries();
    const assembled = await this.#contextAssembler.assemble({
      systemInstruction: this.#systemInstruction,
      ...(this.#runtime ? { runtime: this.#runtime } : {}),
      ...(contextToolSummaries.length > 0 ? { tools: contextToolSummaries } : {}),
      permissionGuidance: DEFAULT_PERMISSION_GUIDANCE,
      ...(this.#skillIndex.length > 0 ? { skillIndex: this.#skillIndex } : {}),
      ...(input.recentMessages ? { recentMessages: input.recentMessages } : {}),
      userMessage: input.message
    });

    yield this.#event({
      ...base,
      type: "context_assembled",
      messageCount: assembled.modelInput.messages.length,
      systemInstructionIncluded: assembled.report.includedSections.includes("identity")
    });

    const toolDefinitions = this.#buildToolDefinitions();
    let messages = assembled.modelInput.messages;
    let steps = 0;
    let stallCount = 0;
    this.#currentTodos = [];

    while (steps < this.#maxSteps) {
      if (this.#compaction !== undefined) {
        messages = await compactMessages(messages, this.#modelProvider, this.#compaction);
      }

      yield this.#event({ ...base, type: "model_request_started", provider: "configured" });

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
            yield this.#event({ ...base, type: "token_delta", delta: streamEvent.delta });
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

      yield this.#event({ ...base, type: "model_request_completed", provider: "configured" });

      steps++;

      if (output.type === "error") {
        yield this.#event({ ...base, type: "run_failed", error: { message: output.message, recoverable: output.recoverable } });
        return;
      }

      if (output.type === "message") {
        // Detect planning-only turns (model narrates a plan without taking action).
        // Only applies when actionable user-provided tools exist (update_todos alone
        // is not enough — the model needs real tools to act with).
        const hasActionableTools = [...this.#tools.keys()].some((n) => n !== "update_todos");
        if (hasActionableTools && isPlanningOnly(output.content)) {
          stallCount++;
          yield this.#event({ ...base, type: "planning_stall_detected", stallCount, maxRetries: this.#maxPlanningStallRetries });

          if (stallCount >= this.#maxPlanningStallRetries) {
            yield this.#event({ ...base, type: "run_failed", error: { message: "Agent stopped after repeated plan-only turns without taking action.", recoverable: false } });
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
        yield this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: output.content } });
        yield this.#event({ ...base, type: "run_completed" });
        return;
      }

      // type === "tool_calls"
      stallCount = 0;
      messages = [...messages, { role: "assistant", content: null, toolCalls: output.calls }];

      const toolResultMessages: ModelMessage[] = [];
      let hardTerminate = false;
      let terminationError = "";

      for (const call of output.calls) {
        yield this.#event({ ...base, type: "tool_call_requested", call });

        const tool = this.#tools.get(call.name);
        if (tool === undefined) {
          const errorMessage = `Tool "${call.name}" is not registered.`;
          yield this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: errorMessage } });
          toolResultMessages.push({ role: "tool", toolCallId: call.id, content: `Error: ${errorMessage}` });
          continue;
        }

        const decision = this.#permissionPolicy.evaluate({
          mode: normalizeAutonomyMode(this.#runtime?.mode),
          action: createToolPermissionAction(call, tool.risk)
        });

        yield this.#event({ ...base, type: "tool_call_permission_evaluated", callId: call.id, toolName: call.name, decision });

        if (decision.decision === "deny") {
          hardTerminate = true;
          terminationError = `Tool call ${call.name} was denied.`;
          break;
        }

        if (decision.decision === "ask") {
          yield this.#event({ ...base, type: "approval_requested", callId: call.id, toolName: call.name, decision });

          const resolution =
            this.#approvalResolver === undefined
              ? { approved: false, reason: "No approval resolver was configured." }
              : await this.#approvalResolver.resolve({ call, decision });

          yield this.#event({ ...base, type: "approval_resolved", callId: call.id, toolName: call.name, resolution });

          if (!resolution.approved) {
            hardTerminate = true;
            terminationError = `Tool call ${call.name} was denied.`;
            break;
          }
        }

        yield this.#event({ ...base, type: "tool_started", callId: call.id, toolName: call.name });

        let result: Awaited<ReturnType<typeof tool.execute>>;
        try {
          result = await tool.execute(call.input, {
            workspaceRoot: this.#runtime?.workspace ?? process.cwd()
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error.";
          yield this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: errorMessage } });
          toolResultMessages.push({ role: "tool", toolCallId: call.id, content: `Error: ${errorMessage}` });
          continue;
        }

        yield this.#event({ ...base, type: "tool_completed", callId: call.id, toolName: call.name, result });
        toolResultMessages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      }

      if (hardTerminate) {
        yield this.#event({ ...base, type: "run_failed", error: { message: terminationError, recoverable: false } });
        return;
      }

      // Emit todos_updated if update_todos was called this batch.
      if (output.calls.some((c) => c.name === "update_todos")) {
        yield this.#event({ ...base, type: "todos_updated", todos: [...this.#currentTodos] });
      }

      messages = [...messages, ...toolResultMessages];
    }

    yield this.#event({ ...base, type: "run_failed", error: { message: `Agent loop reached the step limit of ${this.#maxSteps}.`, recoverable: false } });
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

function isPlanningOnly(content: string): boolean {
  return PLAN_PROMISE_RE.test(content) || PLAN_HEADING_RE.test(content) || PLAN_BULLET_RE.test(content);
}

// SubagentFactory creates a new AgentRuntime for a sub-agent goal.
export interface SubagentFactory {
  create(goal: string): AgentRuntime;
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

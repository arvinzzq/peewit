/**
 * INPUT: ContextAssembler, ModelProvider, PermissionPolicy, optional ApprovalResolver, optional Planner, optional PlanApprovalResolver, executable tools, maxSteps, runtime metadata, user turn input, and optional recent conversation messages.
 * OUTPUT: AgentRuntime, runtime event contracts, in-memory trace store, plan events, plan step execution loop, tool-call request events, permission evaluation events, approval resolution events, and tool lifecycle events.
 * POS: Core runtime layer; coordinates a turn without owning adapters or vendor APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type {
  ContextAssembler,
  ContextAssemblyResult,
  ContextRuntimeMetadata,
  ContextSkillSummary,
  ContextToolSummary
} from "@arvinclaw/context";
import type { ModelMessage, ModelProvider, ModelRequestOptions, ModelToolCall, ModelToolDefinition } from "@arvinclaw/models";
import {
  DefaultPermissionPolicy,
  type AutonomyMode,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRiskLevel
} from "@arvinclaw/permissions";
import type { Plan, PlanStep, Planner, PlannerContext } from "@arvinclaw/planner";
import type { ExecutableTool, ToolExecutionResult } from "@arvinclaw/tools";

export const corePackageName = "@arvinclaw/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
  "plan_created",
  "plan_approval_requested",
  "plan_approval_resolved",
  "plan_step_started",
  "plan_step_completed",
  "plan_step_failed",
  "plan_completed",
  "model_request_started",
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

export interface PlanCreatedEvent extends RuntimeEventBase {
  type: "plan_created";
  plan: Plan;
}

export interface PlanApprovalRequestedEvent extends RuntimeEventBase {
  type: "plan_approval_requested";
  plan: Plan;
}

export interface PlanApprovalResolvedEvent extends RuntimeEventBase {
  type: "plan_approval_resolved";
  planId: string;
  approved: boolean;
  reason: string;
}

export interface PlanStepStartedEvent extends RuntimeEventBase {
  type: "plan_step_started";
  planId: string;
  step: PlanStep;
  stepIndex: number;
  totalSteps: number;
}

export interface PlanStepCompletedEvent extends RuntimeEventBase {
  type: "plan_step_completed";
  planId: string;
  step: PlanStep;
}

export interface PlanStepFailedEvent extends RuntimeEventBase {
  type: "plan_step_failed";
  planId: string;
  step: PlanStep;
  error: { message: string };
}

export interface PlanCompletedEvent extends RuntimeEventBase {
  type: "plan_completed";
  planId: string;
}

export interface ModelRequestStartedEvent extends RuntimeEventBase {
  type: "model_request_started";
  provider: string;
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
  | PlanCreatedEvent
  | PlanApprovalRequestedEvent
  | PlanApprovalResolvedEvent
  | PlanStepStartedEvent
  | PlanStepCompletedEvent
  | PlanStepFailedEvent
  | PlanCompletedEvent
  | ModelRequestStartedEvent
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

export interface PlanApprovalRequest {
  plan: Plan;
}

export interface PlanApprovalResolver {
  resolvePlan(request: PlanApprovalRequest): Promise<ApprovalResolution>;
}

export interface AgentRuntimeDependencies {
  contextAssembler: ContextAssembler;
  modelProvider: ModelProvider;
  permissionPolicy?: PermissionPolicy;
  approvalResolver?: ApprovalResolver;
  planner?: Planner;
  planApprovalResolver?: PlanApprovalResolver;
  tools?: ExecutableTool[];
  skillIndex?: ContextSkillSummary[];
  maxSteps?: number;
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  createRunId?: () => string;
  createEventId?: () => string;
  now?: () => string;
}

const DEFAULT_MAX_STEPS = 12;

const DEFAULT_PERMISSION_GUIDANCE =
  "Low-risk actions run automatically. Medium and high-risk actions require approval. Blocked actions are never permitted.";

export class AgentRuntime {
  readonly #contextAssembler: ContextAssembler;
  readonly #modelProvider: ModelProvider;
  readonly #permissionPolicy: PermissionPolicy;
  readonly #approvalResolver: ApprovalResolver | undefined;
  readonly #planner: Planner | undefined;
  readonly #planApprovalResolver: PlanApprovalResolver | undefined;
  readonly #tools: Map<string, ExecutableTool>;
  readonly #skillIndex: ContextSkillSummary[];
  readonly #maxSteps: number;
  readonly #systemInstruction: string;
  readonly #runtime: ContextRuntimeMetadata | undefined;
  readonly #createRunId: () => string;
  readonly #createEventId: () => string;
  readonly #now: () => string;

  constructor(dependencies: AgentRuntimeDependencies) {
    this.#contextAssembler = dependencies.contextAssembler;
    this.#modelProvider = dependencies.modelProvider;
    this.#permissionPolicy = dependencies.permissionPolicy ?? new DefaultPermissionPolicy();
    this.#approvalResolver = dependencies.approvalResolver;
    this.#planner = dependencies.planner;
    this.#planApprovalResolver = dependencies.planApprovalResolver;
    this.#tools = new Map((dependencies.tools ?? []).map((tool) => [tool.name, tool]));
    this.#skillIndex = dependencies.skillIndex ?? [];
    this.#maxSteps = dependencies.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#systemInstruction = dependencies.systemInstruction;
    this.#runtime = dependencies.runtime;
    this.#createRunId = dependencies.createRunId ?? randomId("run");
    this.#createEventId = dependencies.createEventId ?? randomId("evt");
    this.#now = dependencies.now ?? (() => new Date().toISOString());
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

    if (this.#planner !== undefined) {
      yield* this.#runWithPlan(input.message, assembled, toolDefinitions, base);
      return;
    }

    // No planner: run inner agent loop directly.
    const result = yield* this.#runInnerLoop(assembled.modelInput.messages, toolDefinitions, assembled.modelInput.options, base);
    if (result.success) {
      yield this.#event({ ...base, type: "run_completed" });
    } else {
      yield this.#event({ ...base, type: "run_failed", error: { message: result.error ?? "Unknown error.", recoverable: result.recoverable ?? false } });
    }
  }

  async *#runWithPlan(
    goal: string,
    assembled: ContextAssemblyResult,
    toolDefinitions: ModelToolDefinition[],
    base: { runId: string; sessionId?: string }
  ): AsyncGenerator<RuntimeEvent, void> {
    const plannerContext: PlannerContext = {
      systemInstruction: this.#systemInstruction,
      availableTools: [...this.#tools.keys()]
    };

    const plan = await this.#planner!.createPlan(goal, plannerContext);
    yield this.#event({ ...base, type: "plan_created", plan });

    // In observe mode, request plan approval before executing any step.
    if (normalizeAutonomyMode(this.#runtime?.mode) === "observe" && this.#planApprovalResolver !== undefined) {
      yield this.#event({ ...base, type: "plan_approval_requested", plan });
      const resolution = await this.#planApprovalResolver.resolvePlan({ plan });
      yield this.#event({ ...base, type: "plan_approval_resolved", planId: plan.id, approved: resolution.approved, reason: resolution.reason });

      if (!resolution.approved) {
        yield this.#event({ ...base, type: "run_failed", error: { message: "Plan was not approved.", recoverable: false } });
        return;
      }
    }

    // Extract the system message from the assembled context to reuse across steps.
    const systemMessage = assembled.modelInput.messages[0];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (step === undefined) continue;

      const runningStep: PlanStep = { ...step, status: "running" };
      yield this.#event({ ...base, type: "plan_step_started", planId: plan.id, step: runningStep, stepIndex: i, totalSteps: plan.steps.length });

      const stepMessage = `${step.description}\n\n(Step ${i + 1} of ${plan.steps.length} for goal: ${goal})`;
      const stepMessages: ModelMessage[] = [
        ...(systemMessage !== undefined ? [systemMessage] : []),
        { role: "user", content: stepMessage }
      ];

      const result = yield* this.#runInnerLoop(stepMessages, toolDefinitions, assembled.modelInput.options, base);

      if (result.success) {
        yield this.#event({ ...base, type: "plan_step_completed", planId: plan.id, step: { ...step, status: "complete" } });
      } else {
        const errorMessage = result.error ?? "Step failed.";
        yield this.#event({ ...base, type: "plan_step_failed", planId: plan.id, step: { ...step, status: "failed" }, error: { message: errorMessage } });
      }
    }

    yield this.#event({ ...base, type: "plan_completed", planId: plan.id });
    yield this.#event({ ...base, type: "run_completed" });
  }

  async *#runInnerLoop(
    initialMessages: ModelMessage[],
    toolDefinitions: ModelToolDefinition[],
    options: ModelRequestOptions | undefined,
    base: { runId: string; sessionId?: string }
  ): AsyncGenerator<RuntimeEvent, { success: boolean; error?: string; recoverable?: boolean }> {
    let messages = initialMessages;
    let steps = 0;

    while (steps < this.#maxSteps) {
      yield this.#event({ ...base, type: "model_request_started", provider: "configured" });

      const output = await this.#modelProvider.generate({
        messages,
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
        ...(options !== undefined ? { options } : {})
      });

      yield this.#event({ ...base, type: "model_request_completed", provider: "configured" });

      steps++;

      if (output.type === "error") {
        return { success: false, error: output.message, recoverable: output.recoverable };
      }

      if (output.type === "message") {
        yield this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: output.content } });
        return { success: true };
      }

      // type === "tool_calls"
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
        return { success: false, error: terminationError, recoverable: false };
      }

      messages = [...messages, ...toolResultMessages];
    }

    return { success: false, error: `Agent loop reached the step limit of ${this.#maxSteps}.`, recoverable: false };
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

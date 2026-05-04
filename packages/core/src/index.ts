/**
 * INPUT: ContextAssembler, ModelProvider, PermissionPolicy, optional ApprovalResolver, executable tools, maxSteps, runtime metadata, user turn input, optional recent conversation messages, and model-requested tool calls.
 * OUTPUT: AgentRuntime, runtime event contracts, in-memory trace store, real tool-calling agent loop, tool-call request events, permission evaluation events, approval resolution events, and tool lifecycle events.
 * POS: Core runtime layer; coordinates a turn without owning adapters or vendor APIs.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type {
  ContextAssembler,
  ContextRuntimeMetadata
} from "@arvinclaw/context";
import type { ModelMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from "@arvinclaw/models";
import {
  DefaultPermissionPolicy,
  type AutonomyMode,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRiskLevel
} from "@arvinclaw/permissions";
import type { ExecutableTool, ToolExecutionResult } from "@arvinclaw/tools";

export const corePackageName = "@arvinclaw/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
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

export interface AgentRuntimeDependencies {
  contextAssembler: ContextAssembler;
  modelProvider: ModelProvider;
  permissionPolicy?: PermissionPolicy;
  approvalResolver?: ApprovalResolver;
  tools?: ExecutableTool[];
  maxSteps?: number;
  systemInstruction: string;
  runtime?: ContextRuntimeMetadata;
  createRunId?: () => string;
  createEventId?: () => string;
  now?: () => string;
}

const DEFAULT_MAX_STEPS = 12;

export class AgentRuntime {
  readonly #contextAssembler: ContextAssembler;
  readonly #modelProvider: ModelProvider;
  readonly #permissionPolicy: PermissionPolicy;
  readonly #approvalResolver: ApprovalResolver | undefined;
  readonly #tools: Map<string, ExecutableTool>;
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
    this.#tools = new Map((dependencies.tools ?? []).map((tool) => [tool.name, tool]));
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

    const assembled = await this.#contextAssembler.assemble(
      this.#runtime
        ? {
            systemInstruction: this.#systemInstruction,
            runtime: this.#runtime,
            ...(input.recentMessages ? { recentMessages: input.recentMessages } : {}),
            userMessage: input.message
          }
        : {
            systemInstruction: this.#systemInstruction,
            ...(input.recentMessages ? { recentMessages: input.recentMessages } : {}),
            userMessage: input.message
          }
    );

    yield this.#event({
      ...base,
      type: "context_assembled",
      messageCount: assembled.modelInput.messages.length,
      systemInstructionIncluded: assembled.report.includedSections.includes("system_instruction")
    });

    const toolDefinitions = this.#buildToolDefinitions();
    let messages: ModelMessage[] = assembled.modelInput.messages;
    let steps = 0;

    while (steps < this.#maxSteps) {
      yield this.#event({ ...base, type: "model_request_started", provider: "configured" });

      const output = await this.#modelProvider.generate({
        messages,
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
        ...(assembled.modelInput.options !== undefined ? { options: assembled.modelInput.options } : {})
      });

      yield this.#event({ ...base, type: "model_request_completed", provider: "configured" });

      steps++;

      if (output.type === "error") {
        yield this.#event({ ...base, type: "run_failed", error: { message: output.message, recoverable: output.recoverable } });
        return;
      }

      if (output.type === "message") {
        yield this.#event({ ...base, type: "assistant_message_created", message: { role: "assistant", content: output.content } });
        yield this.#event({ ...base, type: "run_completed" });
        return;
      }

      // type === "tool_calls": add assistant tool_calls message and execute each tool
      messages = [...messages, { role: "assistant", content: null, toolCalls: output.calls }];

      const toolResultMessages: ModelMessage[] = [];
      let runFailed = false;

      for (const call of output.calls) {
        yield this.#event({ ...base, type: "tool_call_requested", call });

        const tool = this.#tools.get(call.name);
        const decision = this.#permissionPolicy.evaluate({
          mode: normalizeAutonomyMode(this.#runtime?.mode),
          action: createToolPermissionAction(call, tool?.risk ?? "medium")
        });

        yield this.#event({ ...base, type: "tool_call_permission_evaluated", callId: call.id, toolName: call.name, decision });

        if (decision.decision === "deny") {
          yield this.#event({ ...base, type: "run_failed", error: { message: `Tool call ${call.name} was denied.`, recoverable: false } });
          runFailed = true;
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
            yield this.#event({ ...base, type: "run_failed", error: { message: `Tool call ${call.name} was denied.`, recoverable: false } });
            runFailed = true;
            break;
          }
        }

        if (tool === undefined) {
          yield this.#event({ ...base, type: "tool_failed", callId: call.id, toolName: call.name, error: { message: `Tool ${call.name} is not registered.` } });
          yield this.#event({ ...base, type: "run_failed", error: { message: `Tool ${call.name} is not registered.`, recoverable: false } });
          runFailed = true;
          break;
        }

        yield this.#event({ ...base, type: "tool_started", callId: call.id, toolName: call.name });

        const result = await tool.execute(call.input, {
          workspaceRoot: this.#runtime?.workspace ?? process.cwd()
        });

        yield this.#event({ ...base, type: "tool_completed", callId: call.id, toolName: call.name, result });

        toolResultMessages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      }

      if (runFailed) return;

      messages = [...messages, ...toolResultMessages];
    }

    yield this.#event({ ...base, type: "run_failed", error: { message: `Agent loop reached the step limit of ${this.#maxSteps}.`, recoverable: false } });
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

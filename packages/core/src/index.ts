export const corePackageName = "@arvinclaw/core";

export const runtimeEventTypes = [
  "run_started",
  "context_assembled",
  "model_request_started",
  "model_request_completed",
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
  | AssistantMessageCreatedEvent
  | RunCompletedEvent
  | RunFailedEvent;

export function createRuntimeEvent<TEvent extends RuntimeEvent>(event: TEvent): TEvent {
  return event;
}

export function isTerminalRuntimeEvent(event: RuntimeEvent): event is RunCompletedEvent | RunFailedEvent {
  return event.type === "run_completed" || event.type === "run_failed";
}

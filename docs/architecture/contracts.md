# Architecture Contracts

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [contracts.zh-CN.md](./contracts.zh-CN.md)

## 1. Purpose

This document records the first architecture-level contracts between Peewit modules.

These contracts are not final TypeScript APIs. They are design constraints that guide implementation and tests.

Core rule:

Contracts should keep modules replaceable and testable.

## 2. Contract Principles

Peewit contracts should be:

- Adapter-agnostic
- Provider-agnostic
- Tool-safe
- Trace-visible
- Testable with fake implementations
- Small enough to evolve during MVP

The first implementation may adjust names and shapes, but it should preserve responsibility boundaries.

## 3. Agent Runtime

`AgentRuntime` owns a user turn or goal execution.

Conceptual contract:

```ts
interface AgentRuntime {
  runTurn(input: UserTurnInput): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
}
```

It receives user input and emits structured events.

It must not own terminal rendering, HTTP rendering, or provider setup.

## 4. Runtime Events

Runtime events are the bridge between Agent Core and adapters.

Conceptual events:

```ts
type RuntimeEvent =
  | AssistantMessageEvent
  | TraceEvent
  | ApprovalRequestEvent
  | RunCompletedEvent
  | RunFailedEvent;
```

Adapters render these events differently, but should not reinterpret agent behavior.

## 5. Model Provider

`ModelProvider` normalizes model vendor behavior.

Conceptual contract:

```ts
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
}
```

The provider returns either assistant text, tool calls, or a normalized error.

## 6. Context Assembler

`ContextAssembler` creates model input from safe sources.

Conceptual contract:

```ts
interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>;
}
```

It owns prompt assembly, source ordering, truncation, redaction, and context reports.

CLI and Web UI must not assemble prompts directly.

## 7. Tool Registry

`ToolRegistry` describes and resolves tools.

Conceptual contract:

```ts
interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): Tool | undefined;
}
```

Tool inputs are untrusted until validated.

## 8. Tool

A tool executes one external capability.

Conceptual contract:

```ts
interface Tool {
  definition: ToolDefinition;
  validate(input: unknown): ToolValidationResult;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}
```

Tools do not decide whether an action is allowed. Permissions own that decision.

## 9. Permission Policy

`PermissionPolicy` classifies actions before execution.

Conceptual contract:

```ts
interface PermissionPolicy {
  evaluate(action: ToolAction, context: PermissionContext): PermissionDecision;
}
```

The policy returns allow, ask, or deny. The adapter asks the user when needed.

## 10. Session Store

`SessionStore` persists conversation and run records.

Conceptual contract:

```ts
interface SessionStore {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  appendTurn(sessionId: string, turn: SessionTurn): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
}
```

MVP can use a lightweight local implementation, but callers should depend on the interface.

## 11. Trace Sink

`TraceSink` records structured trace events.

Conceptual contract:

```ts
interface TraceSink {
  append(event: TraceEvent): Promise<void>;
  list(query: TraceQuery): Promise<TraceEvent[]>;
}
```

Trace events must be redacted before display and before persistence when practical.

## 12. Config Loader

`ConfigLoader` produces effective configuration.

Conceptual contract:

```ts
interface ConfigLoader {
  load(input: ConfigLoadInput): Promise<EffectiveConfig>;
  redacted(config: EffectiveConfig): RedactedConfigView;
}
```

Agent Core should receive configured dependencies, not the config loader itself.

## 13. Approval Adapter Boundary

Approval UX belongs to adapters.

Conceptual contract:

```ts
interface ApprovalResponder {
  respond(requestId: string, decision: ApprovalDecision): Promise<void>;
}
```

The permission package decides that approval is needed. The CLI or Web UI collects the user decision.

## 14. Testing Requirements

Contracts should be protected by tests.

Required test areas:

- Fake implementations can satisfy each contract.
- AgentRuntime works with fake provider, fake tools, fake permission policy, and fake trace sink.
- Provider output normalization matches tool registry expectations.
- Permission decisions are trace-visible.
- ContextAssembler output can be sent to ModelProvider without adapter-specific data.
- CLI adapter only consumes RuntimeEvents and approval requests.

## 15. Acceptance Criteria

The architecture contracts are successful when:

- Each major module has a clear boundary.
- Core contracts are small enough for MVP implementation.
- Contracts support fake implementations for tests.
- Adapter, provider, tool, permission, context, session, and trace responsibilities are separated.
- Future Web UI can reuse the same runtime contracts.

## 16. Related Documents

- [Runtime Composition](./runtime-composition.md)
- [Testing Strategy](./testing-strategy.md)
- [Agent Loop](./agent-loop.md)
- [CLI Adapter](./cli-adapter.md)
- [Model Provider](./model-provider.md)
- [Tool System](./tool-system.md)
- [Permission System](./permission-system.md)
- [Session Storage](./session-storage.md)

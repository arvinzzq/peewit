# 0001: OpenClaw-Aligned Core Architecture

Status: Accepted
Date: 2026-05-02

Simplified Chinese version: [0001-openclaw-aligned-core-architecture.zh-CN.md](./0001-openclaw-aligned-core-architecture.zh-CN.md)

## 1. Context

ArvinClaw started as a plan for a TypeScript CLI-first general agent inspired by OpenClaw.

After deeper OpenClaw research, the project should be more explicit: ArvinClaw is an OpenClaw-like implementation from zero to one, with OpenClaw as the primary architecture reference.

The research notes show that OpenClaw's core architecture is not only an agent loop with tools. It also relies on:

- Session-scoped serialized runs
- Global and per-session queues
- Session write locks
- A dedicated context assembly path
- Workspace bootstrap files
- System prompt sections
- Context engine and compaction
- Memory tools and memory flush behavior
- Streaming event bridges

## 2. Decision

ArvinClaw will align its core architecture with OpenClaw's documented run shape:

```text
intake -> context assembly -> model inference -> tool execution -> streaming/trace -> persistence
```

This changes the design emphasis in four ways:

1. Context assembly becomes a first-class module.
2. Prompt assembly must not live inside the CLI.
3. Runs should be modeled with explicit run IDs and future per-session serialization.
4. Session persistence should prepare for write locks and replayable traces.

## 3. MVP Impact

MVP still stays small.

MVP should include:

- CLI chat entry
- Agent Core
- ModelProvider
- Tool System
- Permission System
- Skill index
- Session storage
- Execution trace
- Basic context assembly package

MVP should not include yet:

- Full context engine plugins
- Automatic long-term memory writes
- Background heartbeat automation
- Multi-agent routing
- Remote node runtime

## 4. Architecture Changes

The repository structure should add a context package:

```text
packages/
  context/
```

Responsibilities:

- Build model context
- Assemble base system prompt
- Add runtime metadata
- Add session resume context
- Add skill index
- Add tool descriptions
- Add permission policy guidance
- Later load workspace prompt files
- Later support compaction and context engine plugins

## 5. Testing Impact

New required test categories:

- Context assembly ordering
- Prompt section inclusion
- Skill index inclusion without full skill body dumping
- Tool description projection
- Permission policy guidance inclusion
- Session resume context bounds
- Future workspace file loading order
- Future compaction summary inclusion

These tests should be introduced before or alongside implementation of `packages/context`.

## 6. Consequences

Positive:

- ArvinClaw better matches OpenClaw's real architecture.
- Prompt assembly becomes testable.
- Future workspace files and memory can be added cleanly.
- CLI remains an adapter instead of owning prompt construction.

Trade-offs:

- MVP has one more package boundary.
- Early implementation requires more design discipline.
- Some features feel farther away because we are making core boundaries explicit.

## 7. Related Documents

- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)
- [OpenClaw architecture map](../architecture/openclaw-architecture-map.md)
- [Main design](../product/arvinclaw-design.md)
- [Agent loop](../architecture/agent-loop.md)
- [Prompt assembly](../architecture/prompt-assembly.md)
- [Session storage](../architecture/session-storage.md)

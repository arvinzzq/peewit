# Node Protocol

Status: Phase 10 Foundation
Date: 2026-05-05

Simplified Chinese version: [node-protocol.zh-CN.md](./node-protocol.zh-CN.md)

## 1. Purpose

This document describes Peewit's future direction toward a multi-node agent architecture and establishes the Phase 10 foundation that makes that direction possible.

## 2. Future Multi-Node Direction

A node is any process or device that can host one or more `AgentRuntime` instances and communicate with other nodes. In a mature multi-node Peewit:

- A desktop node might host the primary personal agent.
- A server node might host long-running background tasks.
- A mobile node might host a lightweight read-only assistant.
- Nodes communicate over a shared protocol: session events, tool results, approval requests, and heartbeats.

This is the direction OpenClaw's architecture points toward. Peewit will approach it incrementally.

## 3. Phase 10 Foundation: Single-Process Sub-Agents

Phase 10 does not implement a true multi-node protocol. Instead, it establishes the foundation:

- Sub-agents run in-process using the same `AgentRuntime` class.
- The `SubagentFactory` interface gives adapters control over how sub-runtimes are created.
- The `SessionGateway` tracks which sessions are alive and which adapter owns them.

These primitives are the in-process equivalents of what a multi-node protocol would need: session identity, runtime creation, and lifecycle tracking.

## 4. Protocol Shape for Phase 10+

When Peewit adds a real node protocol in a future phase, the expected message types are:

- `session.register` — a node announces a new session and its capabilities.
- `session.heartbeat` — a node confirms a session is still alive.
- `session.unregister` — a node announces a session has ended.
- `event.forward` — a node forwards a runtime event to interested parties.
- `tool.request` — a runtime requests a tool execution from another node.
- `tool.result` — a node returns a tool execution result.
- `approval.request` — a runtime requests user approval from a capable adapter.
- `approval.response` — an adapter returns an approval decision.

The `SessionGateway` in Phase 10 handles the session lifecycle messages locally. In a future phase, the gateway would receive these messages over a network transport instead of in-process calls.

## 5. Design Constraints

To keep the Phase 10+ upgrade path open:

- Do not encode transport-specific assumptions into `SessionGateway`; it should be wrappable.
- Do not hard-code approval routing in adapters; route through `ApprovalResolver`.
- `GatewaySession` fields should match the fields a network registration message would carry.

## 6. References

- [Multi-Agent Runtime](./multi-agent-runtime.md) — sub-agent concept and factory interface
- [Gateway](./gateway.md) — session registry and Phase 10 implementation
- [OpenClaw Architecture Map](./openclaw-architecture-map.md) — OpenClaw's confirmed node protocol direction

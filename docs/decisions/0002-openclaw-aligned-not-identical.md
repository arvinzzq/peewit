# 0002: OpenClaw-Aligned, Not Identical

Status: Accepted
Date: 2026-05-02

Simplified Chinese version: [0002-openclaw-aligned-not-identical.zh-CN.md](./0002-openclaw-aligned-not-identical.zh-CN.md)

## 1. Context

ArvinClaw's target is to build an OpenClaw-like personal general-purpose agent.

OpenClaw is the primary architecture reference, but ArvinClaw is also a learning project and a product for our own use. That means blindly copying every implementation detail would be the wrong goal.

The project needs a clear position on how closely to match OpenClaw.

## 2. Decision

ArvinClaw will be:

```text
OpenClaw-inspired, OpenClaw-aligned, ArvinClaw-owned.
```

This means:

- Product target: OpenClaw-like.
- Architecture reference: OpenClaw-first.
- Implementation details: owned by ArvinClaw.
- MVP: not full OpenClaw parity.
- Long-term roadmap: gradual parity with OpenClaw's core capabilities.
- Claude Code: secondary engineering-practice reference.

## 3. What Must Align

ArvinClaw should align with OpenClaw's core concepts:

- Agent workspace
- Workspace prompt files
- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- Daily memory files
- Skills and plugins
- Tools and permissions
- Context assembly
- Session persistence
- Gateway and multi-entry direction
- Channels
- Background automation
- Multi-agent and multi-node direction

These concepts represent the architecture shape of an OpenClaw-like personal agent.

## 4. What Does Not Need to Match Exactly

ArvinClaw does not need to copy:

- Function names
- File names outside public concepts
- Internal module boundaries
- Queue implementation details
- Database choice
- Plugin packaging format
- CLI command names
- UI layout
- Exact default policies
- Exact provider abstractions

If OpenClaw has a mature implementation that is too complex for ArvinClaw's current phase, ArvinClaw should implement a simpler version first.

## 5. Evaluation Rule

When deciding whether to copy an OpenClaw behavior, ask:

1. Is this a core product capability or just an implementation detail?
2. Does it help us understand general agent architecture?
3. Does it make the system safer, more usable, or more extensible?
4. Can we test it at our current phase?
5. Can we explain it clearly in documentation?

If the answer is no, defer or redesign it.

## 6. Examples

### Memory Files

ArvinClaw should keep the concepts of `SOUL.md`, `USER.md`, `MEMORY.md`, and daily memory files.

ArvinClaw does not need to immediately match OpenClaw's full memory engine, hybrid search, or dreaming behavior.

### Gateway

ArvinClaw should keep the long-term gateway and multi-entry direction.

ArvinClaw does not need to implement a production-grade gateway in MVP.

### Skills

ArvinClaw should keep local `SKILL.md` skills and later evolve toward plugins.

ArvinClaw can start with a smaller skill loader and simpler prompt integration.

### Context Engine

ArvinClaw should adopt context assembly as a first-class concept.

ArvinClaw can implement a simple deterministic assembler before introducing plugin-provided context engines.

## 7. Consequences

Positive:

- ArvinClaw stays aligned with OpenClaw's shape.
- MVP remains understandable and testable.
- The project can make independent design trade-offs.
- Documentation can explain why a feature is copied, simplified, deferred, or redesigned.

Trade-offs:

- ArvinClaw may diverge from OpenClaw implementation details.
- Some OpenClaw behaviors may need explicit compatibility decisions later.
- We need regular research passes to avoid drifting away from important OpenClaw concepts.

## 8. Related Documents

- [OpenClaw architecture map](../architecture/openclaw-architecture-map.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)
- [Reference systems](../architecture/reference-systems.md)
- [Main design](../product/arvinclaw-design.md)

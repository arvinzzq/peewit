# ArvinClaw

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

ArvinClaw is an OpenClaw-inspired personal general-purpose agent project.

The goal is twofold:

- Build a real CLI-first agent that can grow into a broader personal agent platform.
- Learn the architecture behind OpenClaw-like systems by implementing each module from first principles.

## Current Phase

ArvinClaw is in Phase 1: MVP agent loop.

Phase 0 foundation is complete. Phase 1 is now building the first message-only agent loop.

Current Phase 1 progress:

- Runtime event contracts are implemented.
- `ModelProvider`, fake provider, and OpenAI-compatible provider are implemented.
- Minimal context assembly is implemented.
- Message-only `AgentRuntime.runTurn` is implemented.
- CLI chat runtime wiring is still in progress.

Phase 1 does not include full tool execution, long-term memory, or Web UI yet.

## Documentation

Start here:

- [Documentation Index](./docs/README.md)
- [Main Design](./docs/product/arvinclaw-design.md)
- [Roadmap](./docs/roadmap/overview.md)
- [Phase 1 Plan](./docs/plans/phase-1-mvp-agent-loop.md)

## Development

Install dependencies:

```text
pnpm install
```

Run checks:

```text
pnpm run check
```

Run the CLI shell:

```text
pnpm run cli --help
```

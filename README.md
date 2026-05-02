# ArvinClaw

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

ArvinClaw is an OpenClaw-inspired personal general-purpose agent project.

The goal is twofold:

- Build a real CLI-first agent that can grow into a broader personal agent platform.
- Learn the architecture behind OpenClaw-like systems by implementing each module from first principles.

## Current Phase

ArvinClaw is in Phase 0: project foundation.

Phase 0 focuses on:

- TypeScript workspace setup
- Package boundaries
- CLI shell
- Initial configuration layer
- Test and documentation checks

It does not include real model calls, tool execution, long-term memory, or Web UI yet.

## Documentation

Start here:

- [Documentation Index](./docs/README.md)
- [Main Design](./docs/product/arvinclaw-design.md)
- [Roadmap](./docs/roadmap/overview.md)
- [Phase 0 Plan](./docs/plans/phase-0-foundation.md)

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

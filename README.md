# ArvinClaw

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

ArvinClaw is an OpenClaw-inspired personal general-purpose agent project.

The goal is twofold:

- Build a real CLI-first agent that can grow into a broader personal agent platform.
- Learn the architecture behind OpenClaw-like systems by implementing each module from first principles.

## Current Phase

ArvinClaw is in Phase 2: Tools and permissions.

Phase 0 (foundation), Phase 1 (MVP agent loop), and the early Phase 5 session and memory foundations are complete.

Current Phase 2 progress:

- Tool registry, permission policy, and runtime tool-call orchestration are implemented.
- `read_file`, `list_directory`, guarded `write_file`, and guarded `run_shell` tools are implemented with workspace boundary enforcement, secret file blocking, and destructive command pattern detection.
- CLI approval prompts are wired for medium and high-risk tool calls.
- Session storage (in-memory and JSONL), workspace prompt loading, and read-only memory file policy are implemented as early Phase 5 foundations.

Phase 2 remaining work: web tools.

## Documentation

Start here:

- [Documentation Index](./docs/README.md)
- [Main Design](./docs/product/arvinclaw-design.md)
- [Roadmap](./docs/roadmap/overview.md)
- [Phase 2 Plan](./docs/plans/phase-2-tools-and-permissions.md)

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

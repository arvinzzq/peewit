# ArvinClaw

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

ArvinClaw is an OpenClaw-inspired personal general-purpose agent project.

The goal is twofold:

- Build a real CLI-first agent that can grow into a broader personal agent platform.
- Learn the architecture behind OpenClaw-like systems by implementing each module from first principles.

## Current Phase

Phase 2 (tools and permissions) is complete. ArvinClaw is ready to begin Phase 3: lightweight skills.

Completed phases:

- Phase 0: Project foundation — monorepo, config, documentation layout.
- Phase 1: MVP agent loop — CLI chat, ModelProvider, context assembly, execution trace.
- Phase 2: Tools and permissions — `read_file`, `list_directory`, guarded `write_file`, guarded `run_shell`, and `read_web_page` tools with workspace enforcement, secret file blocking, destructive pattern detection, and risk-based approval prompts.
- Phase 5 (early foundations): JSONL session storage, workspace prompt loading, and read-only memory file policy.

Next: Phase 3 — local `SKILL.md` loading and skill-aware agent behavior.

## Documentation

Start here:

- [Documentation Index](./docs/README.md)
- [Main Design](./docs/product/arvinclaw-design.md)
- [Roadmap](./docs/roadmap/overview.md)
- [Roadmap](./docs/roadmap/overview.md)

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

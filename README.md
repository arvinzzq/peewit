# ArvinClaw

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

ArvinClaw is an OpenClaw-inspired personal general-purpose agent project.

The goal is twofold:

- Build a real, usable general-purpose agent with multiple entry adapters (CLI today, Web UI and others later).
- Learn the architecture behind OpenClaw-like systems by implementing each module from first principles.

## Current Phase

Phases 0–3 are complete. Phase 5 (sessions and memory) is in progress with early foundations done. Phase 4 is revised — see the roadmap for details.

Completed phases:

- Phase 0: Project foundation — monorepo, config, documentation layout.
- Phase 1: MVP agent loop — CLI chat, ModelProvider, context assembly, execution trace.
- Phase 2: Tools and permissions — `read_file`, `list_directory`, guarded `write_file`, guarded `run_shell`, and `read_web_page` tools with workspace enforcement, secret file blocking, destructive pattern detection, and risk-based approval prompts.
- Phase 3: Context assembly and skills — XML-tagged system prompt sections (identity, runtime, tooling, safety, skills, workspace), Anthropic provider via `ANTHROPIC_API_KEY`, `SKILL.md` skill loader with workspace/user/built-in precedence, built-in skills, `/skills` CLI command, prompt caching for Anthropic.
- Phase 4: In-turn task tracking — model-callable `update_todos` tool (equivalent to OpenClaw `update_plan` and Claude Code `TodoWrite`), planning stall detection with retry injection in `AgentRuntime`, and CLI task progress display.
- Phase 5 (early foundations): JSONL session storage, workspace prompt loading, and read-only memory file policy.

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

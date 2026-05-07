# 0003: Technology Stack Selection

Status: Accepted
Date: 2026-05-03

Simplified Chinese version: [0003-technology-stack-selection.zh-CN.md](./0003-technology-stack-selection.zh-CN.md)

## 1. Context

Vole is an OpenClaw-like personal general-purpose agent built from zero to one.

The project has two goals:

- Build a real product that can become useful for daily work.
- Teach the architecture of OpenClaw-like agents through readable modules, tests, and bilingual documentation.

The technology stack should therefore support both product growth and learning clarity. It should stay close enough to OpenClaw to make comparison meaningful, but it should not copy production complexity before Vole needs it.

OpenClaw's public repository is a TypeScript and Node.js project that uses pnpm workspaces for source development. Its workspace includes the root package, UI, packages, and extensions. This makes pnpm an important reference choice for Vole.

## 2. Decision

Vole will use:

| Area | Choice |
| --- | --- |
| Primary language | TypeScript |
| Runtime | Node.js |
| Package manager | pnpm |
| Monorepo mechanism | pnpm workspace |
| Type checking | TypeScript project references with `tsc -b` |
| Development-time TypeScript execution | `tsx` |
| Test runner | Vitest |
| Initial build strategy | No bundler in Phase 0; use direct TypeScript execution and type checking |

The repository will use `pnpm-workspace.yaml` for workspace membership instead of the `workspaces` field in `package.json`.

## 3. Why pnpm

pnpm is a better long-term fit for Vole than npm workspaces because:

- It matches OpenClaw's public source-development shape more closely.
- It handles monorepos with many packages and future extensions well.
- Its stricter dependency resolution exposes accidental implicit dependencies earlier.
- It keeps dependency installs efficient as the number of packages grows.
- It gives us a clean path toward future `apps/`, `packages/`, `extensions/`, and `ui/` workspaces.

The initial cost is acceptable because the project is still early:

- Developers need pnpm available locally.
- Commands change from `npm run ...` to `pnpm run ...`.
- `package-lock.json` is replaced by `pnpm-lock.yaml`.
- Some dependency mistakes may surface earlier because pnpm does not flatten dependencies the same way npm often does.

These costs are smaller now than they would be after the project has more packages, scripts, CI jobs, and documentation.

## 4. Why TypeScript and Node.js

TypeScript and Node.js are the right first stack because:

- OpenClaw is TypeScript and Node.js based.
- CLI, tools, file system access, shell execution, web requests, and future gateway work fit Node.js naturally.
- TypeScript makes module contracts visible for learning.
- Type tests and unit tests can protect architecture boundaries as the system grows.
- The same language can support CLI, core packages, provider adapters, skills, and future Web UI integration.

This does not prevent later native or platform-specific components. Desktop apps, mobile nodes, browser automation, or sandbox backends can be added later behind package boundaries.

## 5. Why No Bundler Yet

Phase 0 does not need a bundler.

The immediate goal is to establish package boundaries, tests, configuration, CLI shape, and documentation. Running TypeScript directly with `tsx` keeps feedback fast and keeps the build path easy to understand.

A bundler should be introduced when there is real pressure from:

- CLI distribution
- Single-file executable packaging
- Web UI builds
- Extension packaging
- Performance-sensitive startup
- Release automation

Until then, `tsc -b`, `tsx`, and Vitest are enough.

## 6. Module Stack Direction

| Module | Initial Stack | Future Direction |
| --- | --- | --- |
| `apps/cli` | TypeScript, `tsx`, Node.js terminal APIs | Rich TUI or command runner if needed |
| `packages/core` | TypeScript domain logic | Run queue, session serialization, event streaming |
| `packages/config` | TypeScript validation logic | JSON schema or stronger validation library if needed |
| `packages/context` | Deterministic TypeScript prompt assembly | Workspace files, memory retrieval, compaction |
| `packages/models` | OpenAI-compatible HTTP/provider abstraction | Anthropic, Gemini, Ollama, local providers |
| `packages/tools` | TypeScript tool registry | File, shell, web, browser, MCP, extension tools |
| `packages/permissions` | TypeScript risk and policy rules | Sandbox integration and persisted approvals |
| `packages/skills` | Local `SKILL.md` discovery | Plugin SDK and marketplace-style extension model |
| `packages/sessions` | File-backed JSON/JSONL first | SQLite or embedded database when querying is needed |
| Future Web UI | Not in Phase 0 | Vite or another UI build tool when Web UI starts |

The stack should grow only when a phase creates real pressure for the next tool.

## 7. Testing Impact

Every module and iteration should have tests that match its risk.

Required early checks:

- Type checking with `tsc -b`
- Unit tests with Vitest
- Package-boundary tests
- CLI behavior tests
- Config precedence and redaction tests
- Documentation link and bilingual heading checks

Future stack changes must include tests or checks that prove the new tool does not weaken module boundaries or documentation consistency.

## 8. Consequences

Positive:

- Vole stays close to OpenClaw's TypeScript and pnpm workspace direction.
- The project gets stricter dependency boundaries early.
- The build path remains small enough to learn.
- Future packages and extensions have a natural home.

Trade-offs:

- Contributors must use pnpm instead of only npm.
- Some dependency issues may appear earlier and require explicit package dependencies.
- A future bundler decision is still deferred.

## 9. Related Documents

- [OpenClaw-Aligned Core Architecture](./0001-openclaw-aligned-core-architecture.md)
- [OpenClaw-Aligned, Not Identical](./0002-openclaw-aligned-not-identical.md)
- [Project Structure](../architecture/project-structure.md)
- [Development Workflow](../architecture/dev-workflow.md)
- [Main Design](../product/vole-design.md)

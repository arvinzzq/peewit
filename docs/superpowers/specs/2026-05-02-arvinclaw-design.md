# ArvinClaw Design Draft

Status: Draft
Date: 2026-05-02

## 1. Project Intent

ArvinClaw is intended to become a real, usable personal general-purpose agent product, while also serving as a learning project for understanding the architecture and implementation principles behind systems like OpenClaw.

The project should not be a toy demo. Each phase should produce something usable, and each important module should include documentation that explains its role in a general agent system.

Reference systems: [docs/architecture/reference-systems.md](../../architecture/reference-systems.md)

OpenClaw architecture map: [docs/architecture/openclaw-architecture-map.md](../../architecture/openclaw-architecture-map.md)

Compatibility decision: [docs/decisions/0002-openclaw-aligned-not-identical.md](../../decisions/0002-openclaw-aligned-not-identical.md)

## 2. Product Goals

ArvinClaw should eventually support multiple user entry points:

- CLI
- Web UI
- Desktop app
- Messaging platforms
- Background automation

The first implementation phase will focus on the CLI. This keeps the initial product small enough to build and inspect while keeping the architecture open for future adapters.

## 3. Learning Goals

The project should explain agent architecture as it is built. Each core module should have a corresponding document that describes:

- Why the module exists
- What responsibility it owns
- What inputs and outputs it has
- What it depends on
- How it collaborates with other modules
- Which later implementations could replace it

Expected documentation areas include:

- Agent loop
- Run queue and session locking
- Prompt assembly
- Context engine
- Planner
- Tool registry
- Permission system
- Skill system
- Model provider abstraction
- Session storage
- Memory
- Runtime and execution tracing

Detailed architecture note for session storage: [docs/architecture/session-storage.md](../../architecture/session-storage.md)

Detailed architecture note for memory system: [docs/architecture/memory-system.md](../../architecture/memory-system.md)

MVP memory boundary:

- MVP includes session memory through session storage.
- MVP does not include full long-term memory.
- Long-term memory is deferred until session storage, trace, permission, and user control are clear.

## 3.1 Testing Goals

Each module and each iteration must include testing coverage appropriate to its risk and responsibility.

Testing should be treated as part of the architecture, not as an afterthought. Every phase should define:

- Unit tests for isolated module behavior
- Integration tests for cross-module contracts
- CLI or adapter-level tests for user-visible workflows when applicable
- Regression tests for permission, tool execution, model output parsing, and trace behavior
- Documentation examples that can be validated when practical

The expected test depth should scale with risk. Permission checks, file writes, shell execution, configuration loading, and model/tool-call parsing require stronger test coverage than simple formatting code.

## 4. Confirmed MVP Direction

The MVP will be a TypeScript / Node.js CLI agent.

Confirmed choices:

- Primary language: TypeScript
- Runtime: Node.js
- Repository structure: lightweight monorepo
- First entry point: CLI
- Later entry points: Web UI, desktop app, messaging platform adapters
- Model design: `ModelProvider` abstraction
- MVP provider: OpenAI-compatible API
- Tool scope: file system, shell, web search and web page reading
- Skill scope: lightweight local `SKILL.md` based skill system
- Autonomy modes: `observe`, `confirm`, and `auto`
- Default MVP mode: likely `confirm`, with `observe` available for learning and debugging
- OpenClaw alignment: prompt assembly, context engine, run queue, session locking, and workspace files are core architecture concepts, not optional later polish.

The Agent Core must not depend on the CLI. CLI should be an adapter over the shared core.

## 4.1 Repository Structure

ArvinClaw should use a lightweight monorepo from the beginning.

Detailed architecture note: [docs/architecture/project-structure.md](../../architecture/project-structure.md)

The goal is to keep core agent capabilities separate from user entry points without introducing heavy release or publishing machinery too early.

Proposed structure:

```text
apps/
  cli/
packages/
  core/
  context/
  models/
  tools/
  skills/
  permissions/
  sessions/
docs/
  architecture/
  roadmap/
  superpowers/specs/
skills/
```

Responsibilities:

- `apps/cli`: CLI entry point and terminal interaction only
- `packages/core`: agent loop, task orchestration, shared domain types
- `packages/context`: prompt assembly, context projection, workspace file loading, and future compaction
- `packages/models`: model provider interfaces and provider implementations
- `packages/tools`: tool registry and built-in tools
- `packages/skills`: local skill discovery and prompt integration
- `packages/permissions`: risk classification and approval policy
- `packages/sessions`: session and trace persistence
- `docs`: design, roadmap, and architecture learning documents
- `skills`: project-local skills

The monorepo should remain lightweight during MVP work. It should not start with complex package publishing, release automation, or unnecessary infrastructure.

## 5. Autonomy Modes

ArvinClaw should support multiple execution modes because product usage and learning usage need different levels of visibility and interruption.

| Mode | Primary Use | Behavior |
| --- | --- | --- |
| `observe` | Learning and debugging | Shows each step, plan, tool choice, input/output summary, and waits for confirmation before execution. |
| `confirm` | Default daily use | Low-risk actions can run automatically. High-risk actions require user confirmation. |
| `auto` | Trusted automation | Runs continuously within the allowed permission policy, stopping for dangerous actions, failures, or missing permissions. |

The system should expose an explainable execution trace, not the model's hidden chain of thought. The trace should explain what the agent is doing, why it selected a tool, what result came back, and what it plans to do next.

## 6. MVP Tool Scope

MVP tools:

Detailed architecture note: [docs/architecture/tool-system.md](../../architecture/tool-system.md)

- File system read
- Directory listing
- File writing
- Shell command execution
- Web search
- Web page reading

Initial permission policy:

- File reading and directory listing may run automatically inside the configured workspace.
- File writing requires confirmation.
- Shell execution requires confirmation.
- Web search and web page reading may run automatically, but should record sources and result summaries.

## 6.1 Permission Model

The MVP should use a risk-based permission model.

Detailed architecture note: [docs/architecture/permission-system.md](../../architecture/permission-system.md)

| Risk | Examples | Default Behavior |
| --- | --- | --- |
| Low | List directories, read files inside the workspace, read public web pages | Automatically allowed |
| Medium | Write files, create files, install dependencies, access paths outside the workspace | Requires confirmation |
| High | Delete files, execute shell commands, modify git state, submit data over the network | Requires explicit confirmation with a risk explanation |
| Blocked | Read likely secret files, delete large directories, run known destructive commands | Denied by default unless explicitly allowed by configuration |

Shell execution should start as High risk even when the command appears simple. Later versions may add a command allowlist for low-risk commands such as `pwd`, `ls`, or `rg`.

Autonomy mode affects how often the user is asked, but it must not bypass the permission policy:

- `observe`: may require confirmation for every step.
- `confirm`: allows Low risk actions automatically and asks for Medium/High.
- `auto`: runs continuously within policy but still stops for High or Blocked actions unless explicitly configured.

Deferred tools:

- Browser automation
- Long-term memory
- Background scheduled tasks
- Multi-agent orchestration
- Remote nodes
- Full sandboxing

## 6.2 Web Tools

Web capabilities should be split into two abstractions:

- `WebSearchProvider`: searches the web and returns candidate results with titles, URLs, snippets, and metadata.
- `WebPageReader`: reads a specific URL and returns clean text, metadata, and source information.

The Agent Core should depend on these abstractions rather than a specific search vendor.

The MVP should support a manually configured search provider. Possible providers include Tavily, Brave Search, SerpAPI, or a compatible HTTP provider. The concrete first provider can be selected during implementation planning.

Web page reading should be a separate tool from search. This lets the agent search first, then choose which pages to inspect.

Web tool results should be summarized in the execution trace and should preserve source URLs for user review.

## 7. Skill System

The MVP should include a lightweight local skill system.

Detailed architecture note: [docs/architecture/skill-system.md](../../architecture/skill-system.md)

A skill is a directory containing at least `SKILL.md`. The file should declare:

- Skill name
- Purpose
- When to use it
- Recommended steps
- Safety notes

The MVP skill system should load local skills only. It should not include a marketplace, remote installation, version management, or trust system yet.

Proposed skill precedence:

1. Project skills: `<workspace>/skills`
2. User skills: `~/.arvinclaw/skills`
3. Built-in skills

Skills should primarily influence agent behavior and instructions. Real actions must still pass through tools and the permission system.

Initial built-in skills:

- `research`: guides web search, source reading, source comparison, and citation-aware summaries.
- `project-inspector`: guides project structure inspection, technology detection, and module summaries.
- `task-planner`: guides decomposition of user goals into executable steps.
- `docs-writer`: guides writing module explanations and learning-oriented documentation.
- `safe-shell`: optional built-in skill that guides shell command risk assessment and command purpose explanation.

## 8. Model Layer

The Agent Core should depend on a `ModelProvider` interface rather than a specific vendor SDK.

Detailed architecture note: [docs/architecture/model-provider.md](../../architecture/model-provider.md)

The MVP should implement only an OpenAI-compatible provider.

Expected configuration:

- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `maxTokens`

Future providers may include:

- Anthropic
- Gemini
- Ollama
- Local OpenAI-compatible runtimes

## 8.1 Configuration and Secrets

The MVP should use configuration files for non-sensitive settings and environment variables for secrets.

Configuration layers:

- Project config: `arvinclaw.config.json` in the current workspace
- User config: `~/.arvinclaw/config.json`
- Environment variables for secrets and overrides

Example non-sensitive configuration:

- Model provider type
- `baseURL`
- `model`
- `temperature`
- `maxTokens`
- Default autonomy mode
- Workspace root
- Enabled tools
- Permission policy defaults

Secrets should not be written into project configuration files. API keys should be provided through environment variables such as `ARVINCLAW_API_KEY`.

The CLI `/config` command should show the effective configuration while hiding secret values.

Future versions may support encrypted local secret storage or OS keychain integration.

## 9. Agent Loop Direction

The preferred direction is an OpenClaw-aligned loop:

Detailed architecture note: [docs/architecture/agent-loop.md](../../architecture/agent-loop.md)

- Each run flows through intake, context assembly, model inference, tool execution, streaming/trace, and persistence.
- Simple tasks can use a direct tool-calling loop.
- Complex tasks can include a lightweight planning phase.
- The architecture should leave room for a stronger Planner later.
- Runs should eventually be serialized per session with a run queue and session write lock.

The loop should support:

- Goal intake
- Context assembly
- Optional planning
- Tool selection
- Permission check
- Tool execution
- Observation
- Plan update or final response
- Execution trace persistence

## 9.2 Context Assembly

ArvinClaw should treat context assembly as a first-class architecture module, following OpenClaw's separation between runtime orchestration and context construction.

Detailed architecture note for prompt assembly: [docs/architecture/prompt-assembly.md](../../architecture/prompt-assembly.md)

MVP context assembly should include:

- Base system instructions
- Runtime metadata
- Effective configuration
- Session resume context
- Skill index
- Tool descriptions
- Permission policy guidance

OpenClaw-like later context assembly should add:

- `AGENTS.md`
- Read-only `SOUL.md`
- `USER.md`, when long-term memory policy is ready
- `MEMORY.md`, when long-term memory policy is ready
- Recent daily memory files
- Context compaction summaries
- Context engine plugin outputs

Context assembly must be testable and trace-visible. The CLI should not assemble prompts directly.

## 9.1 Execution Trace

The MVP should use an explainable execution trace by default.

Detailed architecture note: [docs/architecture/execution-trace.md](../../architecture/execution-trace.md)

The default trace should show:

- How the agent understood the user's goal
- Whether the agent created or updated a plan
- Which tool the agent selected
- Why the tool was selected
- What permission decision was made
- A safe summary of tool input and output
- What the agent will do next
- The final result

The trace should not expose hidden model reasoning. It should be a product-level explanation of the execution process.

Trace levels:

| Level | Use | Content |
| --- | --- | --- |
| Concise | Quick product use | Tool names, short results, final answer |
| Explainable | Default MVP mode | Goal interpretation, plan, tool choice reason, permission decision, input/output summary, next step |
| Debug | Development | Raw provider messages, raw tool arguments, timing, token usage when available |

The CLI should default to the explainable trace. A later debug option can expose development-level details.

## 10. CLI Direction

The CLI should eventually support both:

- Interactive chat mode, such as `arvinclaw chat`
- Single task mode, such as `arvinclaw run "<goal>"`

Confirmed MVP direction:

- `chat` is the primary first workflow.
- `run` should be reserved in the command structure and may initially reuse a one-shot chat execution path.
- The first version should not include complex `run` parameters, batch processing, background execution, or task queues.

Proposed first CLI commands:

- `/mode observe|confirm|auto`
- `/tools`
- `/skills`
- `/trace`
- `/config`
- `/help`
- `/exit`

The CLI should make the execution trace visible enough for learning without exposing hidden model reasoning.

## 11. Roadmap

The roadmap should evolve ArvinClaw from a small but usable CLI MVP into a full personal agent platform.

Detailed roadmap: [docs/roadmap/overview.md](../../roadmap/overview.md)

| Phase | Goal | Result |
| --- | --- | --- |
| Phase 0 | Project skeleton and documentation system | TypeScript project structure, CLI shell, config system, initial design docs |
| Phase 1 | MVP agent loop | CLI chat, OpenAI-compatible model provider, basic tool loop, execution trace |
| Phase 2 | Tools and permissions | File, shell, and web tools with risk levels and confirmation policy |
| Phase 3 | Lightweight skills | Local `SKILL.md` loading, built-in skills, skill selection, skill documentation |
| Phase 4 | Planning and autonomy modes | Planner, task state, `observe` / `confirm` / `auto`, failure recovery |
| Phase 5 | Sessions, memory, and knowledge | Session storage, task history, long-term memory, local knowledge retrieval |
| Phase 6 | Web UI | Chat UI, task trace, tool call log, permission confirmation panel |
| Phase 7 | Multi-entry adapters | CLI, Web, desktop, and messaging adapters sharing the same Agent Core |
| Phase 8 | Background automation | Scheduler, daemon mode, event triggers, task queue |
| Phase 9 | Plugin and skill ecosystem | Skill installation, enable/disable, permission declarations, version management |
| Phase 10 | Full OpenClaw-like platform | Multi-model, multi-agent, multi-node, sandboxed tools, mature product experience |

Each phase should include:

- User-visible result
- New architecture modules
- Learning documents to add or update
- Acceptance criteria
- Explicit non-goals

## 12. Next Design Work

There are no major MVP direction questions currently open. The next step is to split the accepted design into focused roadmap and architecture documents, then review the full design for ambiguity and scope.

## 13. Documentation Plan

Suggested documentation structure:

```text
docs/
  superpowers/
    specs/
      2026-05-02-arvinclaw-design.md
  architecture/
    agent-loop.md
    model-provider.md
    tool-system.md
    permission-system.md
    skill-system.md
    session-storage.md
    execution-trace.md
  roadmap/
    phase-0.md
    phase-1.md
```

This draft should be updated as the design conversation continues. Once the design is approved, it should be reviewed for placeholders, contradictions, ambiguity, and scope creep before implementation planning begins.

As the design grows, this main document should stay as a concise product and architecture overview. Detailed content should be split into focused documents and referenced from here. Expected split points:

- Roadmap details: `docs/roadmap/`
- Architecture module explanations: `docs/architecture/`
- Phase implementation plans: future planning documents under `docs/superpowers/plans/`
- Product decisions and trade-offs: linked from this design document when they become too detailed

Documentation language policy:

- Every important project document should have both English and Simplified Chinese versions.
- English files use the normal `.md` suffix.
- Simplified Chinese files use `.zh-CN.md`.
- The two versions must be complete translations of the same content.
- Headings, sections, examples, diagrams, tables, and acceptance criteria must stay structurally aligned unless a language-specific note is explicitly marked.
- When a document is updated, its paired language version must be updated in the same design pass.

## 13.1 Commit Policy

Project commits should be small, readable, and easy to revert.

Commit expectations:

- Commit related changes together by topic.
- Avoid mixing unrelated design, implementation, test, and formatting changes.
- Prefer multiple focused commits over one large catch-all commit.
- Commit messages should explain the purpose of the change.
- Documentation updates should be committed with their matching bilingual version.
- Tests should be committed with the behavior they protect whenever practical.
- Large roadmap or architecture changes should be split by module or phase.

This policy exists so future readers can understand how the project evolved and so risky changes can be reverted without losing unrelated work.

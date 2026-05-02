# Prompt Assembly

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [prompt-assembly.zh-CN.md](./prompt-assembly.zh-CN.md)

## 1. Purpose

Prompt assembly builds the model-facing instructions and context for an agent run.

OpenClaw research shows that prompt construction is a core architecture concern, not a CLI detail. ArvinClaw should follow that direction by making prompt assembly explicit, testable, trace-visible, and independent from entry adapters.

The core rule:

Adapters collect user input. Prompt assembly decides what the model sees.

## 2. Why This Module Exists

Without a prompt assembly module, system instructions, skills, tools, memory, workspace files, and session context tend to be mixed directly into CLI or runtime code.

That causes problems:

- Prompt behavior becomes hard to test.
- CLI and Web UI may produce different agent behavior.
- Workspace files may be loaded in inconsistent order.
- Skills may be over-injected or under-injected.
- Sensitive content may enter context without redaction.
- Future context engine and compaction work becomes harder.

Prompt assembly gives ArvinClaw a controlled boundary for all model-facing context.

## 3. Inputs

MVP prompt assembly should accept structured inputs:

- Base system instructions
- Runtime metadata
- Effective configuration
- Current date and time
- Current workspace
- Current autonomy mode
- Permission policy guidance
- Tool definitions
- Skill index
- Session resume context
- Recent trace summaries
- User message

Later phases add:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- Daily memory files
- Context compaction summaries
- Context engine outputs
- Plugin-provided context

## 4. Outputs

Prompt assembly should return a structured model input, not only a string.

Expected output:

- System messages or system sections
- Conversation messages
- Tool definitions
- Context metadata for trace
- Redaction metadata
- Prompt assembly report for debug and tests

This structure lets different model providers render the final request in provider-specific ways without changing the assembly rules.

## 5. MVP Prompt Sections

MVP should start with a small stable set of sections:

- Identity: what ArvinClaw is
- Runtime: current mode, workspace, date, and model context
- Safety: permission policy and blocked behavior
- Tools: available tool summary
- Skills: compact skill index
- Session: recent conversation and observations
- User request: current message

This is smaller than OpenClaw's full prompt, but it follows the same principle of explicit sections.

## 6. OpenClaw-Like Future Sections

Later phases can add OpenClaw-like sections:

- Tooling
- Execution Bias
- Safety
- Skills
- Workspace
- Documentation
- Workspace Files
- Sandbox
- Current Date & Time
- Reply Tags
- Heartbeats
- Runtime
- Reasoning guidance

ArvinClaw should add sections only when their behavior can be documented and tested.

## 7. Skill Index

MVP prompt assembly should include a compact skill index, not every full skill body.

The skill index should include:

- Skill name
- Description
- Source
- When to use it

If the agent needs the full skill body later, it should request or load it through the skill system.

This follows the OpenClaw-style idea that the model can know skills exist without flooding every model call with full `SKILL.md` content.

## 8. Tool Projection

Prompt assembly should project tools into model-facing definitions.

The projection should include:

- Tool name
- Description
- Input schema
- Safety notes when relevant

Tool projection should not include implementation details or secret configuration.

## 9. Workspace Files

Workspace prompt files should be loaded through prompt assembly or context assembly, not through ad hoc reads in Agent Core or CLI.

Planned loading stages:

- MVP/Phase 1: no automatic long-term memory files; optional `AGENTS.md` loading can be added early.
- Phase 1-2: read-only `SOUL.md`.
- Phase 5: `USER.md`, `MEMORY.md`, and daily memory files after memory policy is ready.
- Later: `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`.

Every workspace file load should be trace-visible.

## 10. Redaction

Prompt assembly must apply redaction before content enters model context when practical.

Redaction targets:

- API keys
- Environment secrets
- Secret-like file contents
- Credentials
- Large raw tool outputs
- Sensitive provider metadata

If content is redacted, the prompt assembly report should record that redaction occurred.

## 11. Prompt Assembly Report

Every assembled prompt should be able to produce a report.

The report should include:

- Included sections
- Omitted sections
- Token or size estimates when available
- Skill index entries
- Tool count
- Workspace files loaded
- Redaction events
- Context truncation or compaction events

The report supports debugging, trace, and tests.

## 12. Relationship to Context Engine

Prompt assembly is the deterministic first implementation of context construction.

The future context engine can extend or replace parts of prompt assembly:

- Context projection
- Compaction
- Memory retrieval
- Plugin-provided context
- Provider-specific formatting

MVP should keep prompt assembly simple and deterministic before introducing pluggable context engines.

## 13. Relationship to Model Provider

Prompt assembly should produce provider-neutral model input.

The model provider is responsible for translating that input into vendor-specific request format.

This keeps prompt policy separate from model API details.

## 14. Testing Requirements

Prompt assembly requires tests because small prompt changes can change agent behavior.

Required test areas:

- Section ordering
- Required section inclusion
- Skill index inclusion
- Full skill body exclusion by default
- Tool projection
- Permission guidance inclusion
- Session context bounds
- Workspace file loading order when enabled
- Redaction behavior
- Prompt assembly report contents

Prompt tests should be updated whenever system instructions, skills, tools, memory, context assembly, or model provider formatting changes.

## 15. Acceptance Criteria

MVP prompt assembly should be considered successful when:

- CLI does not assemble prompts directly.
- Agent Core calls a prompt/context assembly module.
- Prompt output is provider-neutral.
- Skill index is included without dumping full skill bodies.
- Tool definitions are projected consistently.
- Permission guidance appears in model context.
- Redaction is applied before sensitive content enters context.
- Prompt assembly behavior is covered by unit tests.

## 16. Related Documents

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)
- [OpenClaw architecture map](./openclaw-architecture-map.md)
- [Context engine](./context-engine.md)
- [Agent loop](./agent-loop.md)
- [Model provider](./model-provider.md)
- [Skill system](./skill-system.md)
- [Permission system](./permission-system.md)

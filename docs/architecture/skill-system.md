# Skill System

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [skill-system.zh-CN.md](./skill-system.zh-CN.md)

## 1. Purpose

The skill system gives ArvinClaw a way to extend agent behavior through reusable instructions.

A skill teaches the agent how to approach a class of tasks, such as research, project inspection, task planning, documentation writing, or safe shell usage.

The core rule:

Skills guide behavior. Tools execute actions. Permissions decide whether actions are allowed.

## 2. Why This Module Exists

Without skills, every workflow must be baked into the core prompt or hard-coded into Agent Core. That makes the system harder to inspect, harder to customize, and harder to evolve.

The skill system gives ArvinClaw:

- Reusable workflow instructions
- Project-specific behavior overrides
- User-specific preferences
- A path toward plugins without starting with a full plugin marketplace
- A learning-friendly way to inspect how agent behavior is shaped

## 3. MVP Scope

The MVP should implement a lightweight local skill system.

MVP includes:

- Loading skills from local directories
- Parsing `SKILL.md`
- Applying precedence rules
- Listing loaded skills in CLI
- Adding relevant skill instructions to model context
- Shipping a small set of built-in skills

MVP does not include:

- Remote skill installation
- Skill marketplace
- Skill version manager
- Skill trust review UI
- Arbitrary permission grants from skill files
- Skill-provided executable code

## 4. Skill Directory Shape

Each skill is a directory containing at least:

```text
SKILL.md
```

Future skills may include supporting files:

```text
research/
  SKILL.md
  examples.md
  templates/
```

MVP can start by reading only `SKILL.md`. Supporting files can be added later once the loading and selection model is clear.

## 5. `SKILL.md` Contents

A skill file should describe:

- Skill name
- Purpose
- When to use it
- Recommended process
- Output expectations
- Safety notes
- Related tools, if any

The format should be simple Markdown. The MVP can use a small frontmatter block plus body content.

Example:

```markdown
---
name: research
description: Use when investigating external information and comparing sources.
---

# Research

Use this skill to search, read sources, compare evidence, and summarize findings with source links.
```

## 6. Skill Loading Locations

Skills should load from three locations.

Precedence order:

1. Project skills: `<workspace>/skills`
2. User skills: `~/.arvinclaw/skills`
3. Built-in skills

If multiple skills have the same name, the higher-precedence skill wins.

This allows a project to override a user or built-in skill when the project has more specific needs.

## 7. Built-In Skills

The MVP should include these built-in skills:

- `research`: guides web search, source reading, source comparison, and citation-aware summaries.
- `project-inspector`: guides project structure inspection, technology detection, and module summaries.
- `task-planner`: guides decomposition of user goals into executable steps.
- `docs-writer`: guides writing module explanations and learning-oriented documentation.
- `safe-shell`: optional built-in skill that guides shell command risk assessment and command purpose explanation.

These skills should prove the system is useful without requiring users to create their own skills immediately.

## 8. Skill Selection

MVP skill selection can start simple.

Possible selection inputs:

- User message
- Explicit CLI command in the future
- Skill descriptions
- Current task type
- Tool request context

Initial behavior can be:

- Load all skills.
- Include a compact skill index in context.
- Let the model select relevant skills.
- Add selected skill instructions to the working context.

Later versions can add deterministic matching, explicit user selection, or a separate skill-selection model step.

## 9. Prompt Integration

Skills should be added to the model context in a controlled way.

The context should include:

- Skill name
- Skill purpose
- Relevant process instructions
- Safety notes

The system should avoid blindly dumping every full skill into every model call. Large or irrelevant skill text can waste context and confuse behavior.

## 10. Skill Boundaries

Skills must not bypass core safety systems.

A skill can:

- Suggest a workflow
- Tell the agent when to use certain tools
- Explain how to evaluate results
- Define output expectations
- Add safety reminders

A skill cannot:

- Execute code directly
- Grant itself tool permissions
- Override blocked actions
- Read files outside the normal tool system
- Change model provider configuration directly
- Persist secrets

## 11. Relationship to Tools

Skills and tools are different.

| Concept | Role |
| --- | --- |
| Skill | Teaches the agent how to approach a task |
| Tool | Performs an external action |
| Permission | Decides whether the action can run |

Example:

- `research` skill tells the agent to compare sources.
- `web_search` tool finds candidate pages.
- `read_web_page` tool reads selected pages.
- Permission policy decides whether those web actions can run.

## 12. Relationship to Plugins

The MVP skill system is not a full plugin system.

Skills are the first step toward extensibility because they are easy to inspect and low risk. Later plugin phases may add:

- Installable packages
- Version metadata
- Permission declarations
- Tool contributions
- Trust review
- Enable/disable controls

The MVP should keep skills as instructions only.

## 13. CLI Behavior

The CLI should eventually support:

- `/skills`: list loaded skills
- `/skills <name>`: show a skill summary
- Future explicit skill activation

MVP can start with `/skills` only.

The CLI should show:

- Skill name
- Source location
- Description
- Whether it overrides another skill

## 14. Skill Errors

Skill loading should handle errors gracefully:

- Missing `SKILL.md`
- Invalid frontmatter
- Duplicate skill names
- Unreadable skill directory
- Empty skill description

Errors should be visible in debug or startup output, but a broken optional skill should not prevent the whole agent from starting unless it is required by configuration.

## 15. Testing Requirements

The skill system needs tests because it shapes agent behavior and future extensibility.

Required test areas:

- Skill discovery from project, user, and built-in locations
- Precedence rules for duplicate names
- `SKILL.md` parsing
- Invalid skill handling
- CLI skill listing
- Prompt integration with selected skills
- Ensuring skills cannot grant permissions or bypass blocked actions
- Regression tests when new skill metadata fields are added

Skill tests should be updated whenever loading locations, precedence rules, prompt assembly, or built-in skills change.

## 16. Acceptance Criteria

The MVP skill system should be considered successful when:

- Skills load from project, user, and built-in locations.
- Project skills override user and built-in skills with the same name.
- Built-in MVP skills are available.
- The CLI can list loaded skills.
- Skill instructions can influence model context.
- Skills cannot execute actions or bypass permissions directly.
- Skill loading errors are reported clearly.
- Skill behavior is covered by unit and integration tests.

## 17. Related Documents

- [Main design](../superpowers/specs/2026-05-02-arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)
- [Agent loop](./agent-loop.md)
- [Tool system](./tool-system.md)
- [Permission system](./permission-system.md)
- [Project structure](./project-structure.md)

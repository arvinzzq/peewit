# ArvinClaw Agent Guide

## Project Role

ArvinClaw is an OpenClaw-like personal general-purpose agent built from zero to one.
It is both a real product and a learning project for agent architecture.
Every implementation change should keep module boundaries, tests, and bilingual documentation understandable.

## Documentation Rules

- Keep important project docs paired as English `.md` and Simplified Chinese `.zh-CN.md`.
- Update local module README and AGENTS files when directory structure or responsibility changes.
- Update required source headers when a file's inputs, outputs, or architecture position changes.
- Do not update global docs for tiny implementation-only edits unless workflow or architecture changes.

## Testing Rules

- Add or update tests when behavior changes.
- Do not require real API keys in unit tests.
- Prefer fake providers, fake context assemblers, and deterministic inputs.
- Run `pnpm run check` before considering work complete.

## Architecture Boundaries

- CLI adapts terminal input/output only.
- Core orchestrates runtime behavior through injected dependencies.
- Context assembles provider-neutral model input.
- Models isolate provider-specific API details.
- Tools execute capabilities but do not decide permissions.
- Permissions decide allow, ask, deny, or block.
- Sessions persist replayable state and traces.

## Update Reminder

Update this file when project-wide agent instructions change.

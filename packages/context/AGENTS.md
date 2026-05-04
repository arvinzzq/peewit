# Context Agent Guide

## Responsibility

Keep model-facing context selection and assembly here. This package produces provider-neutral model input assembled from named sections (identity, runtime, tooling, safety, skills, workspace, conversation_history, user_message) and a per-section assembly report. It accepts tool summaries, skill index, and permission guidance from callers; it does not import the tools, skills, or permissions packages.

## When Files Change

Update README and AGENTS files when context sources, section names, ordering, or section inputs change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Section inclusion and omission, section ordering in the system prompt, tooling section format, safety section format, skills section format, workspace prompt loading, conversation history placement, and assembly report detail need tests. Do not rely on CLI rendering or provider-specific formatting.

## Boundaries

Do not call model providers, execute tools, read secrets, import the tools or permissions packages, or render terminal output here.

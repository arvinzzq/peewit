# Decision 0006 — XML Prompt Format and Prompt Caching

Status: Accepted
Date: 2026-05-04

Simplified Chinese version: [0006-xml-prompt-format-and-caching.zh-CN.md](./0006-xml-prompt-format-and-caching.zh-CN.md)

## Context

ArvinClaw's context assembler (Phase 3) produces a section-based system prompt. Two questions arose after reviewing OpenClaw source research:

1. Should sections be delimited with plain Markdown headers or XML tags?
2. Should the `AnthropicProvider` take advantage of Anthropic's prompt caching API?

## Decision 1 — XML Section Format

Sections should be delimited with XML tags.

Example output from the context assembler:

```xml
<identity>
ArvinClaw is an OpenClaw-inspired personal general-purpose agent...
</identity>

<safety>
Permission guidance: ...
</safety>

<tooling>
Available tools: read_file, list_directory, write_file, run_shell, read_web_page
</tooling>

<skills>
- research: Use when investigating external information or comparing sources.
</skills>
```

### Rationale

Anthropic models are trained to recognize XML tags as structured delimiters. Using XML:

- Produces more reliable section-boundary recognition than Markdown headers.
- Separates section intent from body content without ambiguity.
- Makes sections easy to parse deterministically in tests.
- Follows Anthropic's own recommendation for structuring complex system prompts.

### Alternatives Considered

**Markdown headers (`## Identity`)**: Familiar and readable, but Markdown is part of the prose content, not a structural delimiter. Headers can appear inside section bodies, making them ambiguous as section separators.

**Plain separators (`---`)**: Similar ambiguity problem; separators appear in frontmatter, code blocks, and prose.

**JSON**: Machine-readable but difficult to compose mixed prose and structured content.

## Decision 2 — Prompt Caching

The `AnthropicProvider` should apply `cache_control: { type: "ephemeral" }` to the system content.

Anthropic's API caches the system prompt prefix for up to 5 minutes. Subsequent requests within the window skip re-processing the cached prefix, reducing cost and latency.

### Implementation

When the system content is a string, the provider should send it as a single-element array with `cache_control`:

```typescript
system: [
  {
    type: "text",
    text: systemContent,
    cache_control: { type: "ephemeral" },
  },
],
```

### Section Ordering Implication

To maximize cache hit rate, stable sections must come before volatile sections. Recommended order:

1. `<identity>` — static per installation
2. `<safety>` — changes only on config change
3. `<tooling>` — changes only when tool set changes
4. `<skills>` — changes only when skill files change
5. `<workspace>` — changes only when workspace files change
6. `<runtime>` — includes current date/time; changes every session

This ordering places the most-stable content first so Anthropic can cache the longest possible prefix.

### Alternatives Considered

**No caching**: Simpler but wastes cost and latency on long system prompts with repeated calls. The Phase 3+ system prompt is already large and will grow with workspace files and memory.

**Per-section caching with multiple cache_control markers**: More granular but also more complex. Fine-grained caching can be added later if section-level hit rates are measured.

## Consequences

- `ContextAssembler` must output XML-tagged sections instead of Markdown headers.
- `AnthropicProvider.generate()` must wrap string system content in an array with `cache_control`.
- Section order in `ContextAssembler` must follow the stable-first principle above.
- Tests for context assembly must match the new XML format.
- Tests that check system prompt content must account for XML tags.

## Related Documents

- [Prompt assembly](../architecture/prompt-assembly.md)
- [Model provider](../architecture/model-provider.md)
- [OpenClaw implementation notes](../research/openclaw-implementation-notes.md)

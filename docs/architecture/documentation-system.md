# Documentation System

Status: Draft
Date: 2026-05-02

Simplified Chinese version: [documentation-system.zh-CN.md](./documentation-system.zh-CN.md)

## 1. Purpose

This document defines how ArvinClaw documentation is organized, updated, split, translated, and reviewed.

The documentation is part of the product. It should help users operate ArvinClaw and help learners understand the architecture behind a general-purpose agent.

Core rule:

Documentation should make the project easier to navigate, not become a second hidden implementation.

## 2. Directory Roles

Documentation directories have distinct responsibilities.

| Directory | Responsibility |
| --- | --- |
| `docs/product/` | Product intent, accepted design, scope, and product-level trade-offs |
| `docs/roadmap/` | Phase goals, acceptance criteria, and non-goals |
| `docs/architecture/` | Module responsibilities, boundaries, risks, tests, and collaboration |
| `docs/plans/` | Phase implementation plans before code work begins |
| `docs/research/` | Notes from reference systems, source investigation, and external research |
| `docs/decisions/` | Stable architecture decisions and trade-offs |

If a document does not clearly fit one directory, the content may need to be split.

## 3. Product Documents

Product documents answer:

- What are we building?
- Who is it for?
- What product result should each stage produce?
- What is in scope or out of scope?
- Which trade-offs have been accepted?

Product documents should stay concise. Detailed architecture should link out to `docs/architecture/`.

## 4. Roadmap Documents

Roadmap documents answer:

- What phase are we in?
- What user-visible result does the phase produce?
- Which architecture modules are added?
- What are the acceptance criteria?
- What are the non-goals?

Roadmap documents may list planned future docs as filenames, but should say when they are not created yet.

## 5. Architecture Documents

Architecture documents answer:

- Why does this module exist?
- What does it own?
- What does it not own?
- What are its inputs and outputs?
- How does it collaborate with other modules?
- What are the risks?
- What tests protect it?
- What is deferred?

Architecture documents should be specific enough to guide implementation without pretending to be final code.

## 6. Plan Documents

Plan documents answer:

- What will this phase implement?
- What is explicitly out of scope?
- What order should work happen in?
- What tests are required?
- What verification commands should pass?
- What commit boundaries are recommended?

Implementation should not begin until the relevant plan has been reviewed.

## 7. Research Documents

Research documents record:

- Sources used
- Confirmed facts
- Inferences
- Open questions
- Reference system patterns
- Implications for ArvinClaw

Research should distinguish official sources from inference.

## 8. Decision Records

Decision records are for stable architecture choices.

Use a decision record when:

- Multiple plausible approaches exist.
- The choice affects many modules.
- The choice may be questioned later.
- The trade-off should be easy to find.

Decision records should include context, decision, rationale, consequences, and related docs.

## 9. Bilingual Policy

Important documents must have English and Simplified Chinese versions.

Rules:

- English files use `.md`.
- Simplified Chinese files use `.zh-CN.md`.
- The two versions must be complete translations.
- Headings must stay structurally aligned.
- Tables, examples, diagrams, test requirements, and acceptance criteria must stay aligned.
- Updates should modify both language versions in the same change.

Some English technical terms may remain untranslated when they are project concepts, but the surrounding explanation should be complete.

## 10. Splitting Policy

Split a document when:

- It mixes product decisions with module implementation details.
- One section becomes useful on its own.
- A document becomes hard to review.
- Different audiences need different levels of detail.
- The same concept is referenced from several places.

After splitting, keep the original document as an overview and link to the focused document.

## 11. Planned Documents

Planned documents may appear in roadmap before they exist.

Rules:

- Mark future docs as planned when useful.
- Do not link to missing files as normal Markdown links.
- Create the document when the phase becomes active or when earlier implementation needs the boundary.
- Keep `docs/README.md` focused on existing important docs, not every planned future file.

## 12. Link Policy

Use relative Markdown links for existing docs.

When moving files:

- Update all references.
- Run a Markdown link check.
- Run bilingual heading checks.
- Keep moves in a focused commit.

## 13. Documentation Checks

Useful checks:

- No broken Markdown links.
- Bilingual heading count alignment.
- No stale old directory references.
- Planned docs are clearly marked.
- Main index points to the current key docs.

These checks can begin as manual commands and become automated later.

## 14. Acceptance Criteria

The documentation system is successful when:

- Readers can find product, roadmap, architecture, plan, research, and decision docs quickly.
- Important docs are bilingual and structurally aligned.
- Planned docs are not confused with existing docs.
- Large topics are split into focused documents.
- Documentation supports implementation instead of duplicating it.

## 15. Related Documents

- [Documentation Index](../README.md)
- [Development Workflow](./dev-workflow.md)
- [Testing Strategy](./testing-strategy.md)
- [Main Design](../product/arvinclaw-design.md)
- [Roadmap](../roadmap/overview.md)

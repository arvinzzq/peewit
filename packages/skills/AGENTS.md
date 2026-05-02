# Skills Agent Guide

## Responsibility

Keep skill discovery, metadata extraction, and future full skill loading here. Context assembly should consume compact skill projections instead of reading files directly.

## When Files Change

Update README and AGENTS files when skill responsibilities or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Skill logic will need tests for discovery order, malformed files, metadata extraction, and compact prompt projection.

## Boundaries

Do not execute tools, call providers, or decide which final prompt sections are included here.

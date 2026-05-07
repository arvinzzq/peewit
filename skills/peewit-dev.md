---
name: peewit-dev
description: Development conventions for the Peewit TypeScript monorepo — file editing workflow, test patterns, TypeScript union type narrowing, and bilingual doc rules.
version: "1.0"
---

# Peewit Development Skill

## File Editing Workflow

Use the right tool. Getting this wrong destroys existing code.

| Situation | Tool |
|---|---|
| Modify existing code | `edit_file` (precise string replacement) |
| Add content at end of file | `append_file` |
| Create a new file | `write_file` |
| Fully replace a file intentionally | `write_file` |

**`edit_file` rules:**
- `old_string` must be unique in the file. Add surrounding context if it appears multiple times.
- Use `replace_all: true` to replace every occurrence.
- Returns `string_not_found` (0 matches) or `multiple_matches` (>1, no replace_all).

**When appending to a test file:**
1. Read the existing imports at the top first.
2. If new imports are needed, `edit_file` the import block — don't add imports at the end.
3. `append_file` only the new `describe` block (no import lines).
4. Match the file's existing conventions: this project uses `test()` not `it()`.

## TypeScript Patterns

### Union type narrowing

`ToolExecutionResult` is a discriminated union. Direct property access fails type-checking:

```typescript
// ❌ TypeScript error: property doesn't exist on union
result.matches;

// ✅ Type assertion
const r = result as SearchFilesResult;
r.matches;

// ✅ Discriminant narrowing (fully typed)
if (result.type === "search_files_result") {
  result.matches;
}
```

Check the union in `packages/tools/src/index.ts` when you need to access result-specific fields.

### Strict mode

This project uses `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Be careful with:
- Array access: `arr[i]` is `T | undefined`, not `T`
- Optional properties: assigning `undefined` to an optional prop requires `| undefined` in the type

## Test File Conventions

- Framework: vitest
- Use `test()` not `it()`
- Use `beforeAll` / `afterAll` (not `before` / `after`)
- Create temp workspaces with `mkdtemp(join(tmpdir(), "peewit-<name>-"))`
- Clean up with `rm(workspace, { recursive: true, force: true })` in `afterAll`
- Type-assert results to their specific type before accessing result-specific fields

## Bilingual Doc Rules

Every changed package must have both `README.md` and `README.zh-CN.md` updated in the same commit. The `pnpm run docs:check` script verifies heading count parity — if it fails, a heading was added to one file but not the other.

## Before Every Commit

```bash
pnpm run check   # typecheck + vitest + docs:check
```

Do not commit if this fails.

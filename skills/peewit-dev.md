---
name: peewit-dev
description: >
  Development conventions for the Peewit TypeScript monorepo: file editing
  workflow (edit_file / append_file / write_file), vitest test patterns,
  TypeScript union type narrowing, and bilingual doc rules.
  Use when: writing or modifying TypeScript/test files in this codebase;
  hitting TypeScript type errors; updating bilingual docs; unsure which file
  tool to use.
  Skip when: read-only tasks (search, analysis, answering questions without
  making changes); tasks unrelated to this codebase's code or docs.
version: "1.0"
---

# Peewit Development Conventions

## SOP: Making a Code Change

1. **Locate** — use `search_files` to find the relevant symbol or file before guessing
2. **Read** — `read_file` the target file; understand existing patterns and conventions
3. **Edit** — use the right tool (see File Tools section below)
4. **Verify** — `run_shell command="pnpm run check"` (typecheck + tests + docs parity)
5. **Fix** — if check fails, read the error output, fix, go back to step 4
6. **Done** — report what changed and the check result

Never skip step 4. "It looks right" is not the same as "check passes."

---

## SOP: Writing or Extending a Test File

1. **Read the file** — check existing imports (top of file) and test conventions
2. **Identify needed imports** — do not re-import what already exists
3. **Extend imports if needed** — `edit_file` the existing import block at the top
4. **Append the describe block** — `append_file` with only the `describe(...)` code (no imports)
5. **Run** — `pnpm run check`; fix any TypeScript errors (see union narrowing below)

### Requirements

- Use `test()`, not `it()`
- Use `beforeAll` / `afterAll` for setup/teardown
- Create temp workspaces with `mkdtemp(join(tmpdir(), "peewit-<name>-"))`
- Clean up in `afterAll` with `rm(workspace, { recursive: true, force: true })`
- Import statement location: always at the top of file; never at the end

### Example

**Correct — imports extended at top, describe appended at bottom:**

```
Step 1: edit_file to add to the existing import block at line 5–25:
  old_string: "  createWriteFileTool,"
  new_string: "  createWriteFileTool,\n  createMyNewTool,"

Step 2: append_file the describe block only:
  content: "\ndescribe(\"my_new_tool\", () => {\n  test(\"does X\", ...);\n});\n"
```

**Wrong — imports inside appended content:**

```
append_file content: "import { createMyNewTool } from './index.js';\n\ndescribe..."
                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      TypeScript error: Duplicate identifier
```

---

## File Tools: When to Use Which

| Situation | Tool | Reason |
|---|---|---|
| Modify existing code | `edit_file` | Replaces exact string, preserves surrounding content |
| Add content at end of file | `append_file` | Appends without reading or touching existing content |
| Create a new file | `write_file` | File doesn't exist yet |
| Intentional full replacement | `write_file` | Explicitly replacing everything |

### edit_file Rules

- `old_string` must be unique in the file. If it appears multiple times, add more surrounding context.
- Use `replace_all: true` only when every occurrence should change.
- Error codes: `string_not_found` (0 matches), `multiple_matches` (>1, no replace_all).

### Example

```
Task: rename variable `stallCount` to `planningStallCount`

edit_file:
  path: "packages/core/src/index.ts"
  old_string: "let stallCount = 0;"
  new_string: "let planningStallCount = 0;"
  replace_all: false   ← fails if name appears elsewhere (add context or use replace_all)
```

---

## TypeScript Union Type Narrowing

**Symptom:** `Property 'matches' does not exist on type 'ToolExecutionResult'`

**Cause:** `ToolExecutionResult` is a discriminated union. TypeScript doesn't know which variant you have.

### Three narrowing options

**Option A — type assertion (simplest for single access)**
```typescript
const r = result as SearchFilesResult;
r.matches;
```

**Option B — discriminant narrowing (preferred; fully typed inside block)**
```typescript
if (result.type === "search_files_result") {
  result.matches;  // TypeScript knows this is SearchFilesResult
}
```

**Option C — `in` check (when no `type` discriminant exists)**
```typescript
if ("matches" in result) {
  (result as SearchFilesResult).matches;
}
```

### Where to find union variants

```
packages/tools/src/index.ts — ToolExecutionResult union and all result interfaces
packages/core/src/index.ts  — RuntimeEvent union and all event interfaces
```

---

## Bilingual Doc Rules

Every changed package needs both `README.md` and `README.zh-CN.md` updated in the same commit.

### SOP: Updating Bilingual Docs

1. Update `README.md` (English)
2. Mirror all heading additions/removals in `README.zh-CN.md`
3. Run `pnpm run check` — `docs:check` verifies heading count parity
4. If `docs:check` fails: a heading exists in one file but not the other — fix the mismatch

### Notes

- Heading text can differ between languages; heading *count* per section must match
- A "standalone docs: commit" is only for pure documentation that precedes implementation
- Code + docs always move in the same commit

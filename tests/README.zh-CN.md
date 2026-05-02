# Tests

## Architecture Summary

这个目录拥有 repository-level tests。
它保护 cross-package rules、documentation policy 和 architectural boundaries。
Package-specific behavior 可以放在对应 package 的 `src/*.test.ts` 附近。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `docs-check.test.ts` | Documentation policy tests | 保护 markdown links、bilingual heading counts、module docs 和 source headers。 |
| `package-boundaries.test.ts` | Package boundary tests | 保护 workspace packages，并防止 core packages 依赖 CLI。 |

## Update Reminder

目录结构变化时更新此文件。

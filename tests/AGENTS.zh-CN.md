# Tests Agent Guide

## Responsibility

把 repository-wide architectural 和 documentation tests 保持在这里。模块行为优先使用 package-local tests，cross-cutting rules 使用 repository tests。

## When Files Change

当 repository-level tests 被添加、删除或重命名时，更新 README 和 AGENTS 文件。

## Testing

Tests 应 deterministic，避免真实 provider calls，并通过清晰名称说明它们保护的行为。

## Boundaries

不要把 production implementation 放进这个目录。

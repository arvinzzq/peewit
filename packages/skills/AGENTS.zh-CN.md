# Skills Agent Guide

## Responsibility

把 skill discovery、metadata extraction 和未来 full skill loading 保持在这里。Context assembly 应消费 compact skill projections，而不是直接读取文件。

## When Files Change

当 skill responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Skill logic 将需要 discovery order、malformed files、metadata extraction 和 compact prompt projection 的测试。

## Boundaries

不要在这里执行 tools、调用 providers 或决定最终包含哪些 prompt sections。

# Scripts Agent Guide

## Responsibility

把 repository automation 和 quality gates 保持在这里。Scripts 应支持 checks，除非明确设计为修改项目状态，否则不应改变项目状态。

## When Files Change

当 scripts 被添加、删除或重命名时，更新 README 和 AGENTS 文件。当 script inputs、outputs 或 system position 变化时，更新 script headers。

## Testing

导出逻辑的 scripts 需要在 `tests/` 或 package-level tests 中有测试。优先使用 deterministic fixtures，并避免网络调用。

## Boundaries

不要把产品逻辑藏在 scripts 中。产品行为属于 apps 或 packages。

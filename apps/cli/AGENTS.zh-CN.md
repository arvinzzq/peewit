# CLI Agent Guide

## Responsibility

保持这个 package 专注于终端适配。Agent 行为属于 `packages/core`，prompt/context 工作属于 `packages/context`，provider calls 属于 `packages/models`。

## When Files Change

当文件或职责变化时，更新 `README.md`、`README.zh-CN.md`、`AGENTS.md` 和 `AGENTS.zh-CN.md`。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 的源码文件头。

## Testing

CLI 可见行为需要在 `src/index.test.ts` 中有测试。CLI 单元测试不能要求真实 model provider 或 API key。

## Boundaries

不要在这里 assemble prompts、实例化长期 agent internals、执行 tools 或决定 permissions。

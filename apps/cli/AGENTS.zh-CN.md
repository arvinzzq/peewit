# CLI Agent Guide

## Responsibility

保持这个 package 专注于终端适配。它可以为 CLI commands 组装 runtime、config、包含 daily memory 的 workspace-aware and memory-policy-aware context assembly、built-in file tools、通过 runtime approval resolver 询问用户 approval，以及 durable session/message/trace dependencies，但 Agent 行为属于 `packages/core`，prompt/context 工作属于 `packages/context`，session persistence 属于 `packages/sessions`，provider normalization 属于 `packages/models`，tool implementation 属于 `packages/tools`。

## When Files Change

当文件或职责变化时，更新 `README.md`、`README.zh-CN.md`、`AGENTS.md` 和 `AGENTS.zh-CN.md`。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 的源码文件头。

## Testing

CLI 可见行为、session listing/resume、workspace prompt and read-only long-term/daily memory handoff、interactive input loops、built-in file、shell and web page tool registration、approval prompts、durable message and trace handoff、short-term memory handoff、slash commands、trace rendering、config redaction and memory policy display 和 missing API key handling 需要在 `src/index.test.ts` 中有测试。Configured-provider tests 使用注入的 fake HTTP。CLI 单元测试不能要求真实 model provider 或 API key。

## Boundaries

不要在这里 assemble prompts、implement tools、决定 permissions 或嵌入 vendor-specific provider logic。

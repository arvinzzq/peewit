# Context Agent Guide

## Responsibility

把 model-facing context selection 和 assembly 保持在这里。这个 package 生成由具名 sections 组装的 provider-neutral model input（identity、runtime、tooling、safety、skills、workspace、conversation_history、user_message），以及 per-section assembly report。它从调用方接受 tool summaries、skill index 和 permission guidance；它不导入 tools、skills 或 permissions packages。

## When Files Change

当 context sources、section names、ordering 或 section inputs 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Section inclusion 和 omission、system prompt 中的 section ordering、tooling section format、safety section format、skills section format、workspace prompt loading、conversation history placement 和 assembly report detail 需要测试。不要依赖 CLI rendering 或 provider-specific formatting。

## Boundaries

不要在这里调用 model providers、执行 tools、读取 secrets、导入 tools 或 permissions packages，或渲染 terminal output。

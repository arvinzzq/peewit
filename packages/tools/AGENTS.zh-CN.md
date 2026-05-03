# Tools Agent Guide

## Responsibility

把 tool definitions、registry behavior、validation、normalized results、workspace-bound file tools 和 execution wrappers 保持在这里。Tools 可以描述并运行 capabilities，但 permission decisions 必须留在这个 package 外部。

## When Files Change

当 tool responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Tool logic 需要 registry behavior、executable tool contracts、validation、workspace boundaries、result shapes、error normalization 和 permission metadata 的测试。

## Boundaries

不要在这个 package 中决定 approvals、assemble prompts、调用 model providers 或渲染 CLI prompts。

# Models Agent Guide

## Responsibility

把 provider-specific request 和 response handling 保持在这里。Public outputs 在到达 core 前应归一化为 Peewit model types。

## When Files Change

当 provider responsibilities 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 provider inputs、outputs 或 position 变化时，更新 `src/index.ts` 文件头。

## Testing

Provider behavior 必须可以在无网络访问时测试。注入 fake `fetch` implementations，并断言 normalized outputs 和 secret-safe errors。

## Boundaries

不要把 runtime orchestration、prompt assembly、tool execution 或 CLI rendering 放进这个 package。

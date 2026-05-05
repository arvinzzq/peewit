# Web App Agent Guide

## Responsibility

这个应用是一个 UI 适配器。将 Agent 逻辑（上下文组装、工具执行、权限策略）保留在 packages 中。Web 应用只负责路由 HTTP 请求和渲染事件。

## When Files Change

API 接口或文件清单变更时，更新 README 和 AGENTS 文件。服务器输入、输出或位置变化时，更新 `src/server.ts` 文件头。

## Boundaries

- 不在此处组装提示词或上下文。
- 不在此处定义或执行工具。
- 不在此处应用权限策略。
- 会话存储选择（Phase 6 使用 InMemorySessionStore）可在 Phase 7+ 升级。

## Development

运行 `pnpm --filter @arvinclaw/web run dev` 同时启动 Hono 和 Vite。需要设置 ARVINCLAW_API_KEY。

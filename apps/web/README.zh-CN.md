# Web App

## Architecture Summary

这个目录拥有 Vole 的浏览器端 UI 适配器。
它通过 HTTP/SSE 暴露 Agent Core 并提供 React 前端服务。
它是一个适配器——不拥有提示词组装、工具执行或权限策略。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 web 应用、构建脚本、Hono、React 和 workspace 包依赖。 |
| `tsconfig.json` | TypeScript config | 编译服务端和客户端 TypeScript；composite 用于项目引用。 |
| `vite.config.ts` | Vite config | 打包 React 前端；开发模式下将 /api/* 代理到 Hono。 |
| `public/index.html` | HTML shell | 由 Vite 提供服务的单页应用入口。 |
| `src/server.ts` | Hono API server | POST /api/sessions（创建或恢复）、GET /api/sessions（从 JsonlSessionStore 列出）、GET /api/sessions/:id（单个 session metadata）、GET /api/sessions/:id/messages（消息）、POST /api/sessions/:id/turns（SSE 流）、POST /api/sessions/:id/approvals（解析审批）、GET /api/gateway/sessions（从模块级 SessionGateway 列出活跃 sessions）、GET /ws/:id（WebSocket 端点——客户端发送 `turn`/`approval` JSON 帧，服务端以 JSON 帧流式推送运行时事件）；创建时在 SessionGateway 中注册 sessions，每次 turn 后更新 lastActivityAt；生产环境下提供静态客户端文件。 |
| `src/client/main.tsx` | React entry | 将 `<App>` 挂载到 DOM。 |
| `src/client/App.tsx` | Chat UI | Sessions 页面（列出、新建、恢复）和聊天视图：SSE 流式显示、审批 Modal、Todos 面板、Trace 日志条。 |

## 开发

```sh
# 同时启动服务器和 Vite
pnpm --filter @vole/web run dev
```

开发模式下在浏览器打开 `http://localhost:5173`——API 请求会自动代理到 3120 端口的 Hono 服务器。

启动前设置 `VOLE_API_KEY`（或 `OPENROUTER_API_KEY` + `VOLE_MODEL`）。

## Update Reminder

目录结构变化时更新此文件。

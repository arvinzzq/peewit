# Web App

## Architecture Summary

This directory owns the browser-based UI adapter for ArvinClaw.
It exposes Agent Core over HTTP/SSE and serves a React frontend.
It is an adapter — it does not own prompt assembly, tool execution, or permission policy.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the web app, build scripts, Hono, React, and workspace package dependencies. |
| `tsconfig.json` | TypeScript config | Compiles server and client TypeScript; composite for project references. |
| `vite.config.ts` | Vite config | Bundles the React frontend; proxies /api/* to Hono in development. |
| `public/index.html` | HTML shell | Single-page app entry point served by Vite. |
| `src/server.ts` | Hono API server | POST /api/sessions (create or resume), GET /api/sessions (list from JsonlSessionStore), GET /api/sessions/:id (single session metadata), GET /api/sessions/:id/messages (messages), POST /api/sessions/:id/turns (SSE stream), POST /api/sessions/:id/approvals (resolve), GET /api/gateway/sessions (list active sessions from module-level SessionGateway); registers sessions in SessionGateway on creation, touches lastActivityAt after each turn; serves static client in production. |
| `src/client/main.tsx` | React entry | Mounts `<App>` into the DOM. |
| `src/client/App.tsx` | Chat UI | Sessions page (list, new, resume) and chat view: SSE streaming display, approval modal, todos panel, trace log strip. |

## Development

```sh
# Terminal 1 — Hono server
pnpm --filter @arvinclaw/web dev

# Or run both together
pnpm --filter @arvinclaw/web run dev
```

Open `http://localhost:5173` (Vite) in development — API requests are proxied to Hono at port 3120.

Set `ARVINCLAW_API_KEY` (or `OPENROUTER_API_KEY` + `ARVINCLAW_MODEL`) before starting.

## Update Reminder

Update this file when the directory structure changes.

/**
 * INPUT: HTTP requests, WebSocket frames, env vars (VOLE_API_KEY, VOLE_MODEL, etc.), runtime events from AgentRuntime.
 * OUTPUT: JSON API (sessions CRUD, turns SSE stream, approval resolution, gateway sessions endpoint), WebSocket endpoint (/ws/:id) for bidirectional session communication, static client files in production.
 * POS: Web adapter layer; exposes AgentRuntime over HTTP/SSE/WebSocket without owning agent logic.
 *
 * Session storage: one shared JsonlSessionStore at resolveSessionsDirectory(config).
 * Transient runtime state (runtime, approvalResolver, traceStore) is held in the sessions Map.
 * Persistent session data (messages, trace events) lives in the JsonlSessionStore.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { WEB_CAPABILITIES, filterToolsByProfile, type ToolProfile } from "@vole/adapters";
import { loadConfig, resolveSessionsDirectory, type EffectiveConfig } from "@vole/config";

async function findGitRoot(from: string = process.cwd()): Promise<string | undefined> {
  let dir = from;
  while (true) {
    try { await stat(join(dir, ".git")); return dir; } catch { /* continue */ }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function loadWebConfig(): Promise<EffectiveConfig> {
  const config = loadConfig({ env: process.env as Record<string, string | undefined> });
  if (config.sessions.directory === "~/.vole/sessions") {
    // VOLE_WEB_ROOT is set by the CLI launcher to the user's actual working directory.
    // Without it (e.g. direct node invocation), fall back to process.cwd().
    const searchFrom = process.env["VOLE_WEB_ROOT"] ?? process.cwd();
    const gitRoot = await findGitRoot(searchFrom);
    if (gitRoot !== undefined) config.sessions.directory = join(gitRoot, ".vole", "sessions");
  }
  return config;
}
import { DefaultContextAssembler } from "@vole/context";
import {
  AgentRuntime,
  InMemoryRuntimeTraceStore,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalResolver
} from "@vole/core";
import { SessionGateway } from "@vole/gateway";
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
  type ModelProvider
} from "@vole/models";
import {
  JsonlSessionStore,
  type SessionStore
} from "@vole/sessions";
import { SkillLoader, toSkillSummary } from "@vole/skills";
import {
  createListDirectoryTool,
  createLoadSkillTool,
  createMemoryGetTool,
  createMemorySearchTool,
  createReadFileTool,
  createReadWebPageTool,
  createShellTool,
  createWriteFileTool
} from "@vole/tools";

/** Module-level SessionGateway singleton — tracks all active Web sessions in this process. */
const webGateway = new SessionGateway();

// ─── Web Approval Resolver ────────────────────────────────────────────────────

class WebApprovalResolver implements ApprovalResolver {
  readonly #pending = new Map<string, { request: ApprovalRequest; resolve: (d: ApprovalResolution) => void }>();

  resolve(request: ApprovalRequest): Promise<ApprovalResolution> {
    return new Promise<ApprovalResolution>((resolve) => {
      this.#pending.set(request.call.id, { request, resolve });
    });
  }

  settle(callId: string, decision: ApprovalResolution): boolean {
    const entry = this.#pending.get(callId);
    if (entry === undefined) return false;
    this.#pending.delete(callId);
    entry.resolve(decision);
    return true;
  }

  pendingRequest(callId: string): ApprovalRequest | undefined {
    return this.#pending.get(callId)?.request;
  }
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Transient runtime state for an active web session.
 * Persistent data (messages, trace events) lives in the shared JsonlSessionStore.
 */
interface WebSessionRuntime {
  id: string;
  runtime: AgentRuntime;
  traceStore: InMemoryRuntimeTraceStore;
  approvalResolver: WebApprovalResolver;
}

/** Shared durable store — created once at server start. */
let sharedStore: SessionStore | undefined;

/** Transient runtime state per active session in this process. */
const sessions = new Map<string, WebSessionRuntime>();

/** AbortControllers for in-flight turns — keyed by sessionId. */
const runningTurns = new Map<string, AbortController>();

function getOrCreateSharedStore(config: EffectiveConfig): SessionStore {
  if (sharedStore === undefined) {
    const directory = resolveSessionsDirectory(config, process.env as Record<string, string | undefined>);
    sharedStore = new JsonlSessionStore({ directory });
  }
  return sharedStore;
}

function createProvider(config: EffectiveConfig): ModelProvider {
  if (config.model.provider === "anthropic") {
    return new AnthropicProvider({
      ...(config.secrets.apiKey !== undefined ? { apiKey: config.secrets.apiKey } : {}),
      model: config.model.model,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      ...(config.model.thinkingBudget !== undefined ? { thinkingBudget: config.model.thinkingBudget } : {})
    });
  }
  return new OpenAICompatibleProvider({
    baseURL: config.model.baseURL,
    ...(config.secrets.apiKey !== undefined ? { apiKey: config.secrets.apiKey } : {}),
    model: config.model.model,
    temperature: config.model.temperature,
    maxTokens: config.model.maxTokens
  });
}

async function createWebSession(config: EffectiveConfig, existingSessionId?: string): Promise<WebSessionRuntime> {
  const store = getOrCreateSharedStore(config);
  const approvalResolver = new WebApprovalResolver();
  const traceStore = new InMemoryRuntimeTraceStore();
  const currentDate = new Date().toISOString().slice(0, 10);

  const skillDefinitions = await new SkillLoader().load({ workspaceRoot: config.workspace.root });
  const skillIndex = skillDefinitions.map(toSkillSummary);
  const skillFileMap = new Map(skillDefinitions.map((s) => [s.name, s.filePath]));

  const allWebTools = [
    createReadFileTool(),
    createListDirectoryTool(),
    createWriteFileTool(),
    createShellTool(config.runtime.sandboxed !== undefined ? { sandboxed: config.runtime.sandboxed } : undefined),
    createReadWebPageTool()
  ];

  if (config.memory.longTermFiles === "read-only" || config.memory.longTermFiles === "write") {
    allWebTools.push(createMemorySearchTool(config.workspace.root));
    allWebTools.push(createMemoryGetTool(config.workspace.root));
  }

  if (skillFileMap.size > 0) {
    allWebTools.push(createLoadSkillTool(skillFileMap));
  }

  const tools = config.runtime.toolProfile !== undefined
    ? filterToolsByProfile(allWebTools, config.runtime.toolProfile as ToolProfile)
    : allWebTools;

  const runtime = new AgentRuntime({
    contextAssembler: new DefaultContextAssembler({
      workspacePromptFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "HEARTBEAT.md", "BOOTSTRAP.md"]
    }),
    modelProvider: createProvider(config),
    systemInstruction:
      "You are Vole, a personal general-purpose agent. You can use tools to read files, list directories, write files, run shell commands, and read web pages. You follow a permission policy that governs which actions require user approval.",
    runtime: {
      mode: config.runtime.defaultMode,
      workspace: config.workspace.root,
      currentDate
    },
    tools,
    skillIndex,
    preferStreaming: true,
    approvalResolver,
    ...(config.runtime.promptMode !== undefined ? { promptMode: config.runtime.promptMode } : {}),
    ...(config.runtime.executionContract !== undefined ? { executionContract: config.runtime.executionContract } : {})
  });

  let id: string;

  if (existingSessionId !== undefined) {
    // Resume existing session — verify it exists in the store
    const existing = await store.getSession(existingSessionId);
    if (existing === undefined) {
      throw new Error(`Session "${existingSessionId}" not found in store.`);
    }
    id = existingSessionId;
  } else {
    // Create a new session — use the store's generated ID so the JSONL file
    // name matches the ID used for all subsequent store operations.
    const record = await store.createSession({ title: `session_${crypto.randomUUID()}` });
    id = record.id;
  }

  const sessionRuntime: WebSessionRuntime = { id, runtime, traceStore, approvalResolver };
  sessions.set(id, sessionRuntime);

  const now = new Date().toISOString();
  webGateway.register({
    id,
    adapterName: "web",
    capabilities: WEB_CAPABILITIES,
    registeredAt: now,
    lastActivityAt: now
  });

  return sessionRuntime;
}

// ─── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono();

// CORS for development (Vite dev server on 5173, Hono on 3120)
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
});

app.options("/api/*", (c) => c.text("", 200));

// POST /api/sessions — create new session or resume existing
app.post("/api/sessions", async (c) => {
  let config: EffectiveConfig;
  try {
    config = await loadWebConfig();
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  // Optional: resume an existing session by passing { sessionId }
  const body = await c.req.json<{ sessionId?: string }>().catch(() => ({ sessionId: undefined }));
  const existingSessionId = body.sessionId;

  try {
    const session = await createWebSession(config, existingSessionId);
    return c.json({ sessionId: session.id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create session" }, 400);
  }
});

// GET /api/sessions — list sessions from the durable store
app.get("/api/sessions", async (c) => {
  let config: EffectiveConfig;
  try {
    config = await loadWebConfig();
  } catch {
    return c.json({ sessions: [] });
  }

  try {
    const store = getOrCreateSharedStore(config);
    const sessionRecords = await store.listSessions();
    const list = sessionRecords.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));
    return c.json({ sessions: list });
  } catch {
    return c.json({ sessions: [] });
  }
});

// GET /api/sessions/:id — single session metadata
app.get("/api/sessions/:id", async (c) => {
  let config: EffectiveConfig;
  try {
    config = await loadWebConfig();
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  const id = c.req.param("id");

  try {
    const store = getOrCreateSharedStore(config);
    const session = await store.getSession(id);
    if (session === undefined) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Store error" }, 500);
  }
});

// GET /api/sessions/:id/messages — get messages
app.get("/api/sessions/:id/messages", async (c) => {
  let config: EffectiveConfig;
  try {
    config = await loadWebConfig();
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  const id = c.req.param("id");

  try {
    const store = getOrCreateSharedStore(config);
    const messages = await store.listMessages(id);
    return c.json({ messages });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Store error" }, 500);
  }
});

// POST /api/sessions/:id/turns — run a turn, stream events via SSE
app.post("/api/sessions/:id/turns", async (c) => {
  const id = c.req.param("id");

  // Ensure runtime is initialized for this session
  let sessionRuntime = sessions.get(id);
  if (sessionRuntime === undefined) {
    // Session exists in store but has no active runtime — need to resume
    let config: EffectiveConfig;
    try {
      config = await loadWebConfig();
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
    }

    try {
      sessionRuntime = await createWebSession(config, id);
    } catch {
      return c.json({ error: "Session not found" }, 404);
    }
  }

  const session = sessionRuntime;

  const body = await c.req.json<{ message: string }>();
  const message = body.message?.trim() ?? "";
  if (message === "") return c.json({ error: "Message is required" }, 400);

  let config: EffectiveConfig;
  try {
    config = await loadWebConfig();
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  if (config.secrets.apiKey === undefined) {
    return c.json({ error: "No API key configured. Add one to ~/.vole/config.json or set VOLE_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your shell." }, 400);
  }

  const store = getOrCreateSharedStore(config);
  const recentRaw = await store.listMessages(id, { limit: 12 });
  const recentMessages = recentRaw.map((m) => ({ role: m.role, content: m.content }));

  const controller = new AbortController();
  runningTurns.set(id, controller);

  return streamSSE(c, async (stream) => {
    let assistantText = "";

    try {
    for await (const event of session.runtime.runTurn({ sessionId: id, recentMessages, message, signal: controller.signal })) {
      await session.traceStore.append(event);
      await store.appendTraceEvent({ sessionId: id, event });

      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });

      if (event.type === "assistant_message_created") {
        assistantText = event.message.content;
      }

      if (event.type === "run_completed" || event.type === "run_failed") break;
    }
    } finally {
      runningTurns.delete(id);
    }

    // Persist messages after the turn completes (skip if aborted mid-turn)
    if (!controller.signal.aborted) {
      await store.appendMessage({ sessionId: id, role: "user", content: message });
      if (assistantText !== "") {
        await store.appendMessage({ sessionId: id, role: "assistant", content: assistantText });
      }
    }

    // Update gateway activity timestamp
    webGateway.touch(id);
  });
});

// DELETE /api/sessions/:id/turns — abort the running turn for a session
app.delete("/api/sessions/:id/turns", (c) => {
  const id = c.req.param("id");
  const controller = runningTurns.get(id);
  if (controller === undefined) return c.json({ ok: false, reason: "no running turn" }, 404);
  controller.abort();
  return c.json({ ok: true });
});

// GET /api/gateway/sessions — list all active web sessions registered in the gateway
app.get("/api/gateway/sessions", (c) => {
  return c.json({ sessions: webGateway.list() });
});

// POST /api/sessions/:id/approvals — resolve a pending approval
app.post("/api/sessions/:id/approvals", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (session === undefined) return c.json({ error: "Session not found" }, 404);

  const body = await c.req.json<{ callId: string; approved: boolean; reason?: string }>();
  const decision: ApprovalResolution = {
    approved: body.approved,
    reason: body.reason ?? (body.approved ? "Approved." : "Denied.")
  };

  const ok = session.approvalResolver.settle(body.callId, decision);
  if (!ok) return c.json({ error: "No pending approval with that callId" }, 404);

  return c.json({ success: true });
});

// Serve built client assets in production
// Global install: cwd = dist/web/, client at ./client/
// Dev: cwd = apps/web/, client at ./dist/client/
const clientRoot = existsSync("./client") ? "./client" : "./dist/client";
app.use("/*", serveStatic({ root: clientRoot }));

// ─── Start server ─────────────────────────────────────────────────────────────

const port = Number(process.env["PORT"] ?? 3120);

console.log(`Vole web server starting on http://localhost:${port}`);

const server = serve({ fetch: app.fetch, port });

// ─── WebSocket endpoint: GET /ws/:id ─────────────────────────────────────────
// Bidirectional session communication over WebSocket.
// Client sends { type: "turn", message } or { type: "approval", callId, approved, reason }.
// Server streams runtime events as JSON frames.

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";
  const match = /^\/ws\/([^/?#]+)/.exec(url);
  if (match === null) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const sessionId = match[1] as string;
    const session = sessions.get(sessionId);

    if (session === undefined) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found." }));
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: "connected", sessionId }));

    ws.on("message", (data) => {
      void (async () => {
        const currentSession = sessions.get(sessionId);
        if (currentSession === undefined) { ws.close(); return; }

        let msg: { type: string; message?: string; callId?: string; approved?: boolean; reason?: string };
        try {
          msg = JSON.parse(String(data)) as typeof msg;
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON." }));
          return;
        }

        if (msg.type === "turn" && msg.message !== undefined) {
          const userMessage = msg.message;
          let config: EffectiveConfig;
          try {
            config = await loadWebConfig();
          } catch {
            ws.send(JSON.stringify({ type: "error", message: "Config error." }));
            return;
          }
          const store = getOrCreateSharedStore(config);
          const recentRaw = await store.listMessages(sessionId, { limit: 12 });
          const recentMessages = recentRaw.map((m) => ({ role: m.role, content: m.content }));

          for await (const runtimeEvent of currentSession.runtime.runTurn({ sessionId, recentMessages, message: userMessage })) {
            await currentSession.traceStore.append(runtimeEvent);
            await store.appendTraceEvent({ sessionId, event: runtimeEvent });
            ws.send(JSON.stringify(runtimeEvent));
            if (runtimeEvent.type === "run_completed" || runtimeEvent.type === "run_failed") break;
          }

          await store.appendMessage({ sessionId, role: "user", content: userMessage });
        } else if (msg.type === "approval" && msg.callId !== undefined) {
          currentSession.approvalResolver.settle(msg.callId, {
            approved: msg.approved ?? false,
            reason: msg.reason ?? (msg.approved ? "Approved." : "Denied.")
          });
        }
      })();
    });

    // Session stays alive; only the WS connection closed
    ws.on("close", () => { /* no-op */ });
  });
});

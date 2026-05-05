/**
 * INPUT: HTTP requests, env vars (ARVINCLAW_API_KEY, ARVINCLAW_MODEL, etc.), runtime events from AgentRuntime.
 * OUTPUT: JSON API (sessions CRUD, turns SSE stream, approval resolution), static client files in production.
 * POS: Web adapter layer; exposes AgentRuntime over HTTP/SSE without owning agent logic.
 *
 * Session storage: one shared JsonlSessionStore at resolveSessionsDirectory(config).
 * Transient runtime state (runtime, approvalResolver, traceStore) is held in the sessions Map.
 * Persistent session data (messages, trace events) lives in the JsonlSessionStore.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig, resolveSessionsDirectory, type EffectiveConfig } from "@arvinclaw/config";
import { DefaultContextAssembler } from "@arvinclaw/context";
import {
  AgentRuntime,
  InMemoryRuntimeTraceStore,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalResolver
} from "@arvinclaw/core";
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
  type ModelProvider
} from "@arvinclaw/models";
import {
  JsonlSessionStore,
  type SessionStore
} from "@arvinclaw/sessions";
import { SkillLoader, toSkillSummary } from "@arvinclaw/skills";
import {
  createListDirectoryTool,
  createReadFileTool,
  createReadWebPageTool,
  createShellTool,
  createWriteFileTool
} from "@arvinclaw/tools";

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
      maxTokens: config.model.maxTokens
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

  const tools = [
    createReadFileTool(),
    createListDirectoryTool(),
    createWriteFileTool(),
    createShellTool(),
    createReadWebPageTool()
  ];

  const runtime = new AgentRuntime({
    contextAssembler: new DefaultContextAssembler({
      workspacePromptFiles: ["AGENTS.md", "SOUL.md"]
    }),
    modelProvider: createProvider(config),
    systemInstruction:
      "You are ArvinClaw, a personal general-purpose agent. You can use tools to read files, list directories, write files, run shell commands, and read web pages. You follow a permission policy that governs which actions require user approval.",
    runtime: {
      mode: config.runtime.defaultMode,
      workspace: config.workspace.root,
      currentDate
    },
    tools,
    skillIndex,
    preferStreaming: true,
    approvalResolver
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
    // Create a new session
    id = `session_${crypto.randomUUID()}`;
    await store.createSession({ title: id });
  }

  const sessionRuntime: WebSessionRuntime = { id, runtime, traceStore, approvalResolver };
  sessions.set(id, sessionRuntime);
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
    config = loadConfig({ env: process.env as Record<string, string | undefined> });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  if (config.secrets.apiKey === undefined) {
    return c.json({ error: "Missing API key. Set ARVINCLAW_API_KEY or OPENROUTER_API_KEY." }, 400);
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
    config = loadConfig({ env: process.env as Record<string, string | undefined> });
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
    config = loadConfig({ env: process.env as Record<string, string | undefined> });
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
    config = loadConfig({ env: process.env as Record<string, string | undefined> });
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
      config = loadConfig({ env: process.env as Record<string, string | undefined> });
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
    config = loadConfig({ env: process.env as Record<string, string | undefined> });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Config error" }, 400);
  }

  const store = getOrCreateSharedStore(config);
  const recentRaw = await store.listMessages(id, { limit: 12 });
  const recentMessages = recentRaw.map((m) => ({ role: m.role, content: m.content }));

  return streamSSE(c, async (stream) => {
    let assistantText = "";

    for await (const event of session.runtime.runTurn({ sessionId: id, recentMessages, message })) {
      await session.traceStore.append(event);
      await store.appendTraceEvent({ sessionId: id, event });

      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });

      if (event.type === "assistant_message_created") {
        assistantText = event.message.content;
      }

      if (event.type === "run_completed" || event.type === "run_failed") break;
    }

    // Persist messages after the turn completes
    await store.appendMessage({ sessionId: id, role: "user", content: message });
    if (assistantText !== "") {
      await store.appendMessage({ sessionId: id, role: "assistant", content: assistantText });
    }
  });
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
app.use("/*", serveStatic({ root: "./dist/client" }));

// ─── Start server ─────────────────────────────────────────────────────────────

const port = Number(process.env["PORT"] ?? 3120);

console.log(`ArvinClaw web server starting on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

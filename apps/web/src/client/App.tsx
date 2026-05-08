import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "tool_call" | "tool_result" | "tool_error";

interface ToolCallMsg {
  role: "tool_call";
  toolName: string;
  input?: unknown;
}
interface ToolResultMsg {
  role: "tool_result";
  toolName: string;
  content: string;
}
interface ToolErrorMsg {
  role: "tool_error";
  toolName: string;
  message: string;
}
interface TextMsg {
  role: "user" | "assistant";
  content: string;
}
type ChatMessage = TextMsg | ToolCallMsg | ToolResultMsg | ToolErrorMsg;

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface PendingApproval {
  callId: string;
  toolName: string;
  risk: string;
  reason: string;
  input?: unknown;
}

interface RuntimeEventData {
  type: string;
  delta?: string;
  toolName?: string;
  todos?: TodoItem[];
  call?: { id: string; name: string; input?: unknown };
  decision?: { risk: string; reason: string };
  message?: { content: string };
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface SessionListItem {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatToolResult(result: Record<string, unknown>): string {
  if (Array.isArray(result.entries)) {
    return (result.entries as { name: string; type: string }[])
      .map((e) => `${e.type === "directory" ? "📁" : "📄"} ${e.name}`)
      .join("\n");
  }
  if (typeof result.content === "string") {
    const lines = result.content.split("\n");
    return lines.length > 25 ? lines.slice(0, 25).join("\n") + `\n… (${lines.length - 25} more lines)` : result.content;
  }
  if (typeof result.stdout === "string" || typeof result.stderr === "string") {
    return [result.stdout, result.stderr].filter(Boolean).join("\n") || "(no output)";
  }
  if (Array.isArray(result.results)) {
    return (result.results as { file: string; excerpt: string }[])
      .map((r) => `[${r.file}]\n${r.excerpt}`)
      .join("\n\n");
  }
  if (typeof result.error === "string") return `Error: ${result.error}`;
  return JSON.stringify(result, null, 2);
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

function formatInputPreview(input: unknown): string {
  if (!input) return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch { return ""; }
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Markdown-lite renderer ────────────────────────────────────────────────────
// Detects ``` code blocks and renders them with monospace background.

interface Segment { type: "text" | "code"; content: string; lang?: string }

function parseSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: "text", content: text.slice(last, m.index) });
    const lang = m[1] || undefined;
    segs.push({ type: "code", content: m[2] ?? "", ...(lang !== undefined ? { lang } : {}) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: "text", content: text.slice(last) });
  return segs.length ? segs : [{ type: "text", content: text }];
}

function MessageText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const segs = parseSegments(text);
  return (
    <div style={style}>
      {segs.map((seg, i) =>
        seg.type === "code" ? (
          <pre key={i} style={{
            background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px",
            padding: "10px 14px", overflowX: "auto", fontSize: "13px",
            fontFamily: "'SF Mono', 'Fira Code', monospace", color: "#e6edf3",
            margin: "8px 0", whiteSpace: "pre"
          }}>
            {seg.content}
          </pre>
        ) : (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>{seg.content}</span>
        )
      )}
    </div>
  );
}

// ─── Tool Call Block ──────────────────────────────────────────────────────────

function ToolBlock({ msg }: { msg: ToolCallMsg | ToolResultMsg | ToolErrorMsg }) {
  const [expanded, setExpanded] = useState(false);

  if (msg.role === "tool_call") {
    const preview = formatInputPreview(msg.input);
    return (
      <div style={{ margin: "4px 0 4px 12px", fontSize: "13px", fontFamily: "monospace" }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: "6px", cursor: preview ? "pointer" : "default" }}
          onClick={() => preview && setExpanded(e => !e)}
        >
          <span style={{ color: "#7c8cf8" }}>{"⟳"}</span>
          <span style={{ color: "#94a3b8" }}>{msg.toolName}</span>
          {preview && <span style={{ color: "#475569", fontSize: "11px" }}>{expanded ? "▲" : "▼"}</span>}
        </div>
        {expanded && preview && (
          <pre style={{ margin: "4px 0 0 18px", padding: "6px 10px", background: "#0d1117", borderRadius: "4px", color: "#7dd3fc", fontSize: "12px", whiteSpace: "pre-wrap" }}>
            {preview}
          </pre>
        )}
      </div>
    );
  }

  if (msg.role === "tool_error") {
    return (
      <div style={{ margin: "4px 0 4px 12px", fontSize: "13px", fontFamily: "monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#f87171" }}>{"✗"}</span>
          <span style={{ color: "#94a3b8" }}>{msg.toolName}</span>
          <span style={{ color: "#f87171", fontSize: "12px" }}>{msg.message}</span>
        </div>
      </div>
    );
  }

  // tool_result
  const lines = msg.content.split("\n");
  const isLong = lines.length > 4 || msg.content.length > 200;
  const preview2 = isLong ? lines.slice(0, 4).join("\n") + (lines.length > 4 ? `\n… (${lines.length - 4} more lines)` : "") : msg.content;

  return (
    <div style={{ margin: "4px 0 4px 12px", fontSize: "13px", fontFamily: "monospace" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "6px", cursor: isLong ? "pointer" : "default" }}
        onClick={() => isLong && setExpanded(e => !e)}
      >
        <span style={{ color: "#4ade80" }}>{"✓"}</span>
        <span style={{ color: "#94a3b8" }}>{msg.toolName}</span>
        {isLong && <span style={{ color: "#475569", fontSize: "11px" }}>{expanded ? "▲" : "▼"}</span>}
      </div>
      <pre style={{ margin: "4px 0 0 18px", padding: "4px 8px", background: "#0d1117", borderRadius: "4px", color: "#86efac", fontSize: "12px", whiteSpace: "pre-wrap", maxHeight: expanded ? "none" : "80px", overflow: "hidden" }}>
        {expanded ? msg.content : preview2}
      </pre>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const S = {
  app: { display: "flex", height: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "system-ui,-apple-system,sans-serif", overflow: "hidden" } as React.CSSProperties,

  // sidebar
  sidebar: { width: "240px", minWidth: "240px", display: "flex", flexDirection: "column" as const, background: "#0d1117", borderRight: "1px solid #21262d" },
  sidebarHeader: { padding: "16px 14px 10px", borderBottom: "1px solid #21262d" },
  logo: { fontSize: "16px", fontWeight: 700, color: "#7c8cf8", marginBottom: "10px" },
  newBtn: { width: "100%", padding: "7px 0", background: "#238636", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "13px" },
  sidebarList: { flex: 1, overflowY: "auto" as const, padding: "8px 6px" },
  sessionItem: (active: boolean): React.CSSProperties => ({
    padding: "8px 10px", borderRadius: "6px", cursor: "pointer", marginBottom: "2px",
    background: active ? "#161b22" : "transparent",
    border: `1px solid ${active ? "#30363d" : "transparent"}`
  }),
  sessionTitle: { fontSize: "13px", color: "#c9d1d9", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  sessionDate: { fontSize: "11px", color: "#6e7681", marginTop: "2px" },

  // main
  main: { flex: 1, display: "flex", flexDirection: "column" as const, overflow: "hidden" },
  chatHeader: { padding: "10px 20px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", gap: "10px", background: "#0d1117" },
  chatTitle: { fontSize: "14px", fontWeight: 600, color: "#c9d1d9" },
  chatStatus: { fontSize: "12px", color: "#6e7681", marginLeft: "auto" },

  // messages
  messages: { flex: 1, overflowY: "auto" as const, padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: "12px" },
  msgUser: { alignSelf: "flex-end" as const, maxWidth: "68%", background: "#1f2937", border: "1px solid #374151", borderRadius: "12px 12px 4px 12px", padding: "10px 14px", fontSize: "14px" },
  msgAssistant: { alignSelf: "flex-start" as const, maxWidth: "80%", fontSize: "14px", lineHeight: "1.6" },
  msgAssistantInner: { background: "#161b22", border: "1px solid #21262d", borderRadius: "4px 12px 12px 12px", padding: "10px 14px" },
  streamingOuter: { alignSelf: "flex-start" as const, maxWidth: "80%", fontSize: "14px" },
  streamingInner: { background: "#161b22", border: "1px solid #7c8cf8", borderLeft: "2px solid #7c8cf8", borderRadius: "4px 12px 12px 12px", padding: "10px 14px", whiteSpace: "pre-wrap" as const },
  cursor: { display: "inline-block", background: "#7c8cf8", width: "8px", height: "1em", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" },

  // todos
  todos: { alignSelf: "flex-start" as const, background: "#0d1117", border: "1px solid #21262d", borderRadius: "8px", padding: "10px 14px", fontSize: "13px" },

  // tool status
  toolStatus: { fontSize: "13px", color: "#7c8cf8", padding: "4px 0", fontFamily: "monospace" },

  // input
  inputRow: { padding: "12px 20px", borderTop: "1px solid #21262d", display: "flex", gap: "8px", background: "#0d1117" },
  input: { flex: 1, background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "10px 14px", color: "#e6edf3", fontSize: "14px", outline: "none" } as React.CSSProperties,
  sendBtn: (disabled: boolean): React.CSSProperties => ({
    padding: "10px 20px", background: disabled ? "#21262d" : "#238636", color: disabled ? "#6e7681" : "#fff",
    border: "none", borderRadius: "8px", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "14px"
  }),

  // approval
  approvalOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  approvalCard: { background: "#161b22", border: "1px solid #d29922", borderRadius: "12px", padding: "24px", maxWidth: "460px", width: "90%" },
  approvalTitle: { color: "#d29922", fontWeight: 700, marginBottom: "12px", fontSize: "16px" },
  approvalField: { marginBottom: "8px", fontSize: "14px" },
  approvalPre: { background: "#0d1117", borderRadius: "4px", padding: "8px", fontFamily: "monospace", fontSize: "12px", color: "#7dd3fc", whiteSpace: "pre-wrap" as const, maxHeight: "120px", overflow: "auto", margin: "6px 0 10px" },
  approvalBtns: { display: "flex", gap: "10px", marginTop: "20px" },
  btnApprove: { flex: 1, padding: "10px", background: "#238636", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 },
  btnDeny: { flex: 1, padding: "10px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 },

  // empty state
  empty: { flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", color: "#6e7681", fontSize: "14px", gap: "8px" },
  emptyTitle: { fontSize: "22px", fontWeight: 700, color: "#c9d1d9" },
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  loading: boolean;
}

function Sidebar({ sessions, activeSessionId, onNewSession, onSelectSession, loading }: SidebarProps) {
  return (
    <div style={S.sidebar}>
      <div style={S.sidebarHeader}>
        <div style={S.logo}>⬡ Vole</div>
        <button style={S.newBtn} onClick={onNewSession}>+ New Session</button>
      </div>
      <div style={S.sidebarList}>
        {loading && <div style={{ color: "#6e7681", fontSize: "12px", padding: "8px" }}>Loading…</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={S.sessionItem(s.id === activeSessionId)}
            onClick={() => onSelectSession(s.id)}
          >
            <div style={S.sessionTitle}>{s.title ?? s.id.slice(-16)}</div>
            <div style={S.sessionDate}>{formatDate(s.updatedAt)}</div>
          </div>
        ))}
        {!loading && sessions.length === 0 && (
          <div style={{ color: "#6e7681", fontSize: "12px", padding: "8px" }}>No sessions yet</div>
        )}
      </div>
    </div>
  );
}

// ─── Chat View ────────────────────────────────────────────────────────────────

interface ChatViewProps {
  sessionId: string;
  sessionTitle: string | undefined;
}

function ChatView({ sessionId, sessionTitle }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, currentTool]);

  const sendMessage = useCallback(
    async (msg: string) => {
      if (isSending || msg.trim() === "") return;
      const trimmed = msg.trim();

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setInput("");
      setIsSending(true);
      setStreamingText("");
      setCurrentTool(null);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/turns`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed })
        });

        if (!response.ok || response.body === null) throw new Error(`Server error: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastAssistantText = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6).trim();
          if (!data) return;
          let event: RuntimeEventData;
          try { event = JSON.parse(data) as RuntimeEventData; } catch { return; }

          if (event.type === "token_delta" && event.delta !== undefined) {
            setStreamingText((prev) => prev + event.delta!);
          } else if (event.type === "tool_call_requested" && event.call !== undefined) {
            const { name, input: inp } = event.call;
            setCurrentTool(name);
            setMessages((prev) => [...prev, { role: "tool_call", toolName: name, input: inp }]);
          } else if (event.type === "tool_started" && event.toolName !== undefined) {
            setCurrentTool(event.toolName);
          } else if (event.type === "tool_completed" && event.toolName !== undefined) {
            setCurrentTool(null);
            const resultText = event.result !== undefined ? formatToolResult(event.result) : "";
            setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName!, content: resultText }]);
          } else if (event.type === "tool_failed" && event.toolName !== undefined) {
            setCurrentTool(null);
            setMessages((prev) => [...prev, { role: "tool_error", toolName: event.toolName!, message: event.error?.message ?? "Unknown error" }]);
          } else if (event.type === "todos_updated" && event.todos !== undefined) {
            setTodos([...event.todos]);
          } else if (event.type === "approval_requested" && event.call !== undefined && event.decision !== undefined) {
            setPendingApproval({
              callId: event.call.id,
              toolName: event.call.name,
              risk: event.decision.risk,
              reason: event.decision.reason,
              input: event.call.input
            });
          } else if (event.type === "approval_resolved") {
            setPendingApproval(null);
          } else if (event.type === "assistant_message_created" && event.message !== undefined) {
            lastAssistantText = event.message.content;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) processLine(line.trim());
        }
        buffer += decoder.decode();
        for (const line of buffer.split("\n")) processLine(line.trim());

        setStreamingText("");
        setCurrentTool(null);
        if (lastAssistantText !== "") setMessages((prev) => [...prev, { role: "assistant", content: lastAssistantText }]);
      } catch (err) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, isSending]
  );

  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;
    await apiPost(`/api/sessions/${sessionId}/approvals`, { callId: pendingApproval.callId, approved: true, reason: "Approved by user." }).catch(() => {});
    setPendingApproval(null);
  }, [pendingApproval, sessionId]);

  const handleDeny = useCallback(async () => {
    if (!pendingApproval) return;
    await apiPost(`/api/sessions/${sessionId}/approvals`, { callId: pendingApproval.callId, approved: false, reason: "Denied by user." }).catch(() => {});
    setPendingApproval(null);
  }, [pendingApproval, sessionId]);

  return (
    <>
      <div style={S.chatHeader}>
        <div style={S.chatTitle}>{sessionTitle ?? `Session ${sessionId.slice(-12)}`}</div>
        <div style={S.chatStatus}>{isSending ? "⟳ Thinking…" : `#${sessionId.slice(-8)}`}</div>
      </div>

      <div style={S.messages}>
        {messages.map((msg, i) => {
          if (msg.role === "user") return (
            <div key={i} style={S.msgUser}>{msg.content}</div>
          );
          if (msg.role === "tool_call" || msg.role === "tool_result" || msg.role === "tool_error") return (
            <ToolBlock key={i} msg={msg} />
          );
          // assistant
          return (
            <div key={i} style={S.msgAssistant}>
              <div style={S.msgAssistantInner}>
                <MessageText text={msg.content} />
              </div>
            </div>
          );
        })}

        {streamingText !== "" && (
          <div style={S.streamingOuter}>
            <div style={S.streamingInner}>
              <MessageText text={streamingText} />
              <span style={S.cursor} />
            </div>
          </div>
        )}

        {currentTool !== null && !streamingText && (
          <div style={S.toolStatus}>⟳ {currentTool}</div>
        )}

        {todos.length > 0 && (
          <div style={S.todos}>
            <div style={{ fontWeight: 600, marginBottom: "6px", fontSize: "12px", color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {`Tasks  ${todos.filter(t => t.status === "completed").length}/${todos.length}`}
            </div>
            {todos.map((todo, i) => {
              const icon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "›" : "·";
              const color = todo.status === "completed" ? "#4ade80" : todo.status === "in_progress" ? "#fbbf24" : "#6e7681";
              return (
                <div key={i} style={{ display: "flex", gap: "8px", padding: "2px 0" }}>
                  <span style={{ color, fontFamily: "monospace" }}>{icon}</span>
                  <span style={{ color: todo.status === "completed" ? "#6e7681" : "#c9d1d9", textDecoration: todo.status === "completed" ? "line-through" : "none", fontSize: "13px" }}>{todo.content}</span>
                </div>
              );
            })}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div style={S.inputRow}>
        <input
          style={S.input}
          placeholder={isSending ? "Waiting for response…" : "Message Vole…"}
          value={input}
          disabled={isSending || pendingApproval !== null}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(input); } }}
          autoFocus
        />
        <button style={S.sendBtn(isSending || pendingApproval !== null)} disabled={isSending || pendingApproval !== null} onClick={() => void sendMessage(input)}>
          Send
        </button>
      </div>

      {pendingApproval !== null && (
        <div style={S.approvalOverlay}>
          <div style={S.approvalCard}>
            <div style={S.approvalTitle}>⚠ Approval Required</div>
            <div style={S.approvalField}><strong>Tool: </strong>{pendingApproval.toolName}</div>
            <div style={S.approvalField}>
              <strong>Risk: </strong>
              <span style={{ color: pendingApproval.risk === "high" ? "#f87171" : "#fbbf24" }}>{pendingApproval.risk}</span>
            </div>
            {pendingApproval.input !== undefined && (
              <pre style={S.approvalPre}>{formatInputPreview(pendingApproval.input)}</pre>
            )}
            <div style={{ ...S.approvalField, color: "#8b949e", fontSize: "13px" }}>{pendingApproval.reason}</div>
            <div style={S.approvalBtns}>
              <button style={S.btnApprove} onClick={() => void handleApprove()}>Approve</button>
              <button style={S.btnDeny} onClick={() => void handleDeny()}>Deny</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const { sessions: s } = await apiGet<{ sessions: SessionListItem[] }>("/api/sessions");
      setSessions(s);
    } catch {
      // non-fatal — sidebar just shows empty
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const handleNewSession = useCallback(async () => {
    setError(null);
    try {
      const { sessionId: id } = await apiPost<{ sessionId: string }>("/api/sessions", {});
      const newItem: SessionListItem = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setSessions((prev) => [newItem, ...prev]);
      setActiveSessionId(id);
      setActiveTitle(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  const handleSelectSession = useCallback(async (id: string) => {
    setError(null);
    try {
      const { sessionId: resumedId } = await apiPost<{ sessionId: string }>("/api/sessions", { sessionId: id });
      const s = sessions.find(x => x.id === id);
      setActiveSessionId(resumedId);
      setActiveTitle(s?.title);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [sessions]);

  return (
    <div style={S.app}>
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewSession={() => void handleNewSession()}
        onSelectSession={(id) => void handleSelectSession(id)}
        loading={sessionsLoading}
      />

      <div style={S.main}>
        {error !== null && (
          <div style={{ padding: "10px 20px", background: "#1c0a0a", borderBottom: "1px solid #7f1d1d", color: "#fca5a5", fontSize: "13px", display: "flex", justifyContent: "space-between" }}>
            <span>{error}</span>
            <span style={{ cursor: "pointer", color: "#6e7681" }} onClick={() => setError(null)}>✕</span>
          </div>
        )}

        {activeSessionId !== null ? (
          <ChatView key={activeSessionId} sessionId={activeSessionId} sessionTitle={activeTitle as string | undefined} />
        ) : (
          <div style={S.empty}>
            <div style={S.emptyTitle}>Vole</div>
            <div>Select a session or start a new one</div>
            <button
              style={{ marginTop: "16px", padding: "10px 24px", background: "#238636", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}
              onClick={() => void handleNewSession()}
            >
              + New Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

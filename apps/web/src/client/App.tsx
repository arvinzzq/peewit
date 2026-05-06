import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool_result"; toolName: string; content: string };

function formatToolResult(result: Record<string, unknown>): string {
  if (Array.isArray(result.entries)) {
    return (result.entries as { name: string; type: string }[])
      .map((e) => `${e.type === "directory" ? "📁" : "📄"} ${e.name}`)
      .join("\n");
  }
  if (typeof result.content === "string") {
    const lines = result.content.split("\n");
    return lines.length > 30
      ? lines.slice(0, 30).join("\n") + `\n… (${lines.length - 30} more lines)`
      : result.content;
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

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface PendingApproval {
  callId: string;
  toolName: string;
  risk: string;
  reason: string;
}

interface RuntimeEventData {
  type: string;
  delta?: string;
  toolName?: string;
  todos?: TodoItem[];
  call?: { id: string; name: string };
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

// ─── API helpers ───────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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

// ─── Styles ────────────────────────────────────────────────────────────────────

const css = {
  app: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#0f1117",
    color: "#e2e8f0",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  header: {
    padding: "12px 20px",
    borderBottom: "1px solid #1e2433",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    background: "#161b27"
  },
  title: { fontSize: "18px", fontWeight: 700, color: "#7c8cf8" },
  status: { fontSize: "12px", color: "#64748b" },
  backBtn: {
    padding: "4px 10px",
    background: "transparent",
    border: "1px solid #2d3748",
    borderRadius: "6px",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "12px"
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px"
  },
  msgUser: {
    alignSelf: "flex-end" as const,
    maxWidth: "70%",
    background: "#1e3a5f",
    borderRadius: "12px 12px 4px 12px",
    padding: "10px 14px"
  },
  msgAssistant: {
    alignSelf: "flex-start" as const,
    maxWidth: "80%",
    background: "#1a2035",
    borderRadius: "4px 12px 12px 12px",
    padding: "10px 14px",
    whiteSpace: "pre-wrap" as const
  },
  msgTool: {
    alignSelf: "flex-start" as const,
    maxWidth: "90%",
    background: "#0f1a0f",
    border: "1px solid #2d4a2d",
    borderRadius: "6px",
    padding: "8px 12px",
    fontSize: "13px"
  },
  msgToolLabel: {
    color: "#4ade80",
    fontWeight: 600 as const,
    marginBottom: "6px",
    fontSize: "12px"
  },
  msgToolPre: {
    margin: 0,
    color: "#86efac",
    fontFamily: "monospace" as const,
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px"
  },
  streamingMsg: {
    alignSelf: "flex-start" as const,
    maxWidth: "80%",
    background: "#1a2035",
    borderRadius: "4px 12px 12px 12px",
    padding: "10px 14px",
    whiteSpace: "pre-wrap" as const,
    borderLeft: "2px solid #7c8cf8"
  },
  cursor: { display: "inline-block", background: "#7c8cf8", width: "8px", height: "1em", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" },
  toolStatus: {
    alignSelf: "flex-start" as const,
    color: "#f59e0b",
    fontSize: "13px",
    padding: "6px 12px",
    background: "#1c1a0e",
    borderRadius: "6px"
  },
  todos: {
    alignSelf: "flex-start" as const,
    background: "#0f1a1f",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "13px",
    color: "#94a3b8"
  },
  approvalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100
  },
  approvalCard: {
    background: "#1a2035",
    border: "1px solid #f59e0b",
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "440px",
    width: "90%"
  },
  approvalTitle: { color: "#f59e0b", fontWeight: 700, marginBottom: "12px", fontSize: "16px" },
  approvalField: { marginBottom: "8px", fontSize: "14px" },
  approvalButtons: { display: "flex", gap: "10px", marginTop: "20px" },
  btnApprove: {
    flex: 1,
    padding: "10px",
    background: "#166534",
    color: "#dcfce7",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 600
  },
  btnDeny: {
    flex: 1,
    padding: "10px",
    background: "#7f1d1d",
    color: "#fecaca",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 600
  },
  inputRow: {
    padding: "12px 20px",
    borderTop: "1px solid #1e2433",
    display: "flex",
    gap: "8px",
    background: "#161b27"
  },
  input: {
    flex: 1,
    background: "#0f1117",
    border: "1px solid #2d3748",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#e2e8f0",
    fontSize: "15px",
    outline: "none"
  },
  sendBtn: {
    padding: "10px 20px",
    background: "#7c8cf8",
    color: "#0f1117",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "15px"
  },
  sendBtnDisabled: {
    padding: "10px 20px",
    background: "#2d3748",
    color: "#64748b",
    border: "none",
    borderRadius: "8px",
    cursor: "not-allowed",
    fontWeight: 700,
    fontSize: "15px"
  },
  tracePanel: {
    background: "#0a0d16",
    borderTop: "1px solid #1e2433",
    padding: "8px 20px",
    fontSize: "11px",
    color: "#475569",
    maxHeight: "80px",
    overflowY: "auto" as const
  },
  // Sessions page styles
  sessionsPage: {
    flex: 1,
    padding: "32px 24px",
    overflowY: "auto" as const
  },
  sessionsTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#e2e8f0",
    marginBottom: "8px"
  },
  sessionsSubtitle: {
    fontSize: "14px",
    color: "#64748b",
    marginBottom: "28px"
  },
  newSessionBtn: {
    padding: "12px 24px",
    background: "#7c8cf8",
    color: "#0f1117",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "15px",
    marginBottom: "28px",
    display: "block"
  },
  sessionsList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px"
  },
  sessionsListTitle: {
    fontSize: "13px",
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: "12px"
  },
  sessionItem: {
    background: "#161b27",
    border: "1px solid #1e2433",
    borderRadius: "10px",
    padding: "14px 18px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    transition: "border-color 0.15s"
  },
  sessionItemId: {
    fontSize: "13px",
    fontFamily: "monospace",
    color: "#7c8cf8"
  },
  sessionItemDate: {
    fontSize: "12px",
    color: "#475569"
  },
  emptyState: {
    color: "#475569",
    fontSize: "14px",
    padding: "20px 0"
  }
};

// ─── Sessions Page ─────────────────────────────────────────────────────────────

interface SessionsPageProps {
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
}

function SessionsPage({ onNewSession, onResumeSession }: SessionsPageProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ sessions: SessionListItem[] }>("/api/sessions")
      .then(({ sessions: s }) => setSessions(s))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  return (
    <div style={css.sessionsPage}>
      <div style={css.sessionsTitle}>Sessions</div>
      <div style={css.sessionsSubtitle}>
        Start a new session or continue a previous one.
      </div>

      <button style={css.newSessionBtn} onClick={onNewSession}>
        + New Session
      </button>

      {loading && (
        <div style={css.emptyState}>Loading sessions…</div>
      )}

      {!loading && loadError !== null && (
        <div style={{ ...css.emptyState, color: "#f87171" }}>
          Could not load sessions: {loadError}
        </div>
      )}

      {!loading && loadError === null && (
        <>
          <div style={css.sessionsListTitle}>Previous Sessions</div>
          {sessions.length === 0 ? (
            <div style={css.emptyState}>No previous sessions found.</div>
          ) : (
            <div style={css.sessionsList}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  style={css.sessionItem}
                  onClick={() => onResumeSession(s.id)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#7c8cf8"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#1e2433"; }}
                >
                  <div style={css.sessionItemId}>{s.id}</div>
                  <div style={css.sessionItemDate}>
                    Updated {formatDate(s.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Chat View ────────────────────────────────────────────────────────────────

interface ChatViewProps {
  sessionId: string;
  onBack: () => void;
}

function ChatView({ sessionId, onBack }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [traceLog, setTraceLog] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed })
        });

        if (!response.ok || response.body === null) {
          throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastAssistantText = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6).trim();
          if (data === "") return;

          let event: RuntimeEventData;
          try {
            event = JSON.parse(data) as RuntimeEventData;
          } catch {
            return;
          }

          setTraceLog((prev) => [...prev.slice(-19), event.type]);

          if (event.type === "token_delta" && event.delta !== undefined) {
            setStreamingText((prev) => prev + event.delta!);
          } else if (event.type === "tool_started" && event.toolName !== undefined) {
            setCurrentTool(event.toolName);
          } else if (event.type === "tool_completed" && event.toolName !== undefined) {
            setCurrentTool(null);
            const resultText = event.result !== undefined
              ? formatToolResult(event.result as Record<string, unknown>)
              : "";
            if (resultText !== "") {
              setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName!, content: resultText }]);
            }
          } else if (event.type === "tool_failed") {
            setCurrentTool(null);
            if (event.toolName !== undefined && event.error !== undefined) {
              setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName!, content: `Error: ${event.error!.message}` }]);
            }
          } else if (event.type === "todos_updated" && event.todos !== undefined) {
            setTodos([...event.todos]);
          } else if (
            event.type === "approval_requested" &&
            event.call !== undefined &&
            event.decision !== undefined
          ) {
            setPendingApproval({
              callId: event.call.id,
              toolName: event.call.name,
              risk: event.decision.risk,
              reason: event.decision.reason
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

        // Flush remaining
        buffer += decoder.decode();
        for (const line of buffer.split("\n")) processLine(line.trim());

        setStreamingText("");
        setCurrentTool(null);
        if (lastAssistantText !== "") {
          setMessages((prev) => [...prev, { role: "assistant", content: lastAssistantText }]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` }
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, isSending]
  );

  const handleApprove = useCallback(async () => {
    if (pendingApproval === null) return;
    await apiPost(`/api/sessions/${sessionId}/approvals`, {
      callId: pendingApproval.callId,
      approved: true,
      reason: "Approved by user."
    }).catch(() => {});
    setPendingApproval(null);
  }, [pendingApproval, sessionId]);

  const handleDeny = useCallback(async () => {
    if (pendingApproval === null) return;
    await apiPost(`/api/sessions/${sessionId}/approvals`, {
      callId: pendingApproval.callId,
      approved: false,
      reason: "Denied by user."
    }).catch(() => {});
    setPendingApproval(null);
  }, [pendingApproval, sessionId]);

  return (
    <>
      {/* Header */}
      <div style={css.header}>
        <button style={css.backBtn} onClick={onBack}>
          Sessions
        </button>
        <div style={css.title}>Peewit</div>
        <div style={css.status}>
          {isSending ? "Thinking…" : `Session ${sessionId.slice(-8)}`}
        </div>
      </div>

      {/* Messages */}
      <div style={css.messages}>
        {messages.map((msg, i) =>
          msg.role === "tool_result" ? (
            <div key={i} style={css.msgTool}>
              <div style={css.msgToolLabel}>▶ {msg.toolName}</div>
              <pre style={css.msgToolPre}>{msg.content}</pre>
            </div>
          ) : (
            <div key={i} style={msg.role === "user" ? css.msgUser : css.msgAssistant}>
              {msg.content}
            </div>
          )
        )}

        {/* Streaming current turn */}
        {streamingText !== "" && (
          <div style={css.streamingMsg}>
            {streamingText}
            <span style={css.cursor} />
          </div>
        )}

        {/* Tool progress */}
        {currentTool !== null && (
          <div style={css.toolStatus}>Running: {currentTool}</div>
        )}

        {/* Todos */}
        {todos.length > 0 && (
          <div style={css.todos}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>Tasks</div>
            {todos.map((todo, i) => (
              <div key={i}>
                {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "→" : "·"}{" "}
                {todo.content}
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Trace log */}
      {traceLog.length > 0 && (
        <div style={css.tracePanel}>{traceLog.join(" → ")}</div>
      )}

      {/* Input */}
      <div style={css.inputRow}>
        <input
          style={css.input}
          placeholder={isSending ? "Thinking…" : "Type a message…"}
          value={input}
          disabled={isSending || pendingApproval !== null}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input);
            }
          }}
          autoFocus
        />
        <button
          style={isSending ? css.sendBtnDisabled : css.sendBtn}
          disabled={isSending || pendingApproval !== null}
          onClick={() => void sendMessage(input)}
        >
          Send
        </button>
      </div>

      {/* Approval overlay */}
      {pendingApproval !== null && (
        <div style={css.approvalOverlay}>
          <div style={css.approvalCard}>
            <div style={css.approvalTitle}>Approval Required</div>
            <div style={css.approvalField}>
              <strong>Tool:</strong> {pendingApproval.toolName}
            </div>
            <div style={css.approvalField}>
              <strong>Risk:</strong>{" "}
              <span style={{ color: pendingApproval.risk === "high" ? "#f87171" : "#f59e0b" }}>
                {pendingApproval.risk}
              </span>
            </div>
            <div style={{ ...css.approvalField, color: "#94a3b8" }}>{pendingApproval.reason}</div>
            <div style={css.approvalButtons}>
              <button style={css.btnApprove} onClick={() => void handleApprove()}>
                Approve
              </button>
              <button style={css.btnDeny} onClick={() => void handleDeny()}>
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </>
  );
}

// ─── App component ────────────────────────────────────────────────────────────

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"sessions" | "chat">("sessions");

  const handleNewSession = useCallback(async () => {
    setError(null);
    try {
      const { sessionId: id } = await apiPost<{ sessionId: string }>("/api/sessions", {});
      setSessionId(id);
      setView("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleResumeSession = useCallback(async (id: string) => {
    setError(null);
    try {
      // Resume: POST /api/sessions with the existing session ID to wire up runtime
      const { sessionId: resumedId } = await apiPost<{ sessionId: string }>("/api/sessions", { sessionId: id });
      setSessionId(resumedId);
      setView("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleBack = useCallback(() => {
    setSessionId(null);
    setView("sessions");
  }, []);

  if (error !== null) {
    return (
      <div style={{ ...css.app, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#f87171", fontSize: "16px", maxWidth: "480px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", marginBottom: "12px" }}>Error</div>
          <div>{error}</div>
          <div style={{ marginTop: "8px", fontSize: "13px", color: "#64748b" }}>
            Make sure PEEWIT_API_KEY is set and the server is running.
          </div>
          <button
            style={{ ...css.backBtn, marginTop: "20px", padding: "8px 16px" }}
            onClick={() => setError(null)}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={css.app}>
      {view === "sessions" && (
        <>
          <div style={css.header}>
            <div style={css.title}>Peewit</div>
          </div>
          <SessionsPage
            onNewSession={() => void handleNewSession()}
            onResumeSession={(id) => void handleResumeSession(id)}
          />
        </>
      )}
      {view === "chat" && sessionId !== null && (
        <ChatView sessionId={sessionId} onBack={handleBack} />
      )}
    </div>
  );
}

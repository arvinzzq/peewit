/**
 * INPUT: EffectiveConfig, env, session options (sessionId, resume flag).
 * OUTPUT: Ink-based interactive chat UI with streaming text, tool progress, approval prompts, todos panel, slash-command routing, input history (↑/↓), and Tab autocomplete.
 * POS: CLI Ink rendering layer; replaces readline stdout loop for real interactive sessions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { render, Box, Text, useInput, useApp, useAnimation, useStdout, Static } from "ink";
import TextInput from "ink-text-input";
import { loadConfig, type EffectiveConfig } from "@vole/config";
import type { RuntimeEvent } from "@vole/core";
import type { TodoItem } from "@vole/tools";
import {
  CliChatSession,
  renderToolResult,
  type ApprovalRequest,
  type ApprovalResolution,
  type RunCliOptions
} from "./index.js";
import { Markdown, StreamingMarkdown } from "./Markdown.js";

// ─── Slash commands registry ──────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { command: "/help",   description: "Show available commands" },
  { command: "/resume", description: "Resume a previous session" },
  { command: "/trace",  description: "Show recent trace events" },
  { command: "/config", description: "Show redacted configuration" },
  { command: "/skills", description: "List loaded skills" },
  { command: "/clear",  description: "Clear screen and reset context" },
  { command: "/exit",   description: "Leave chat" },
] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

const VOLE_COLOR = "#d9ff33";

function Spinner({ label }: { label: string }) {
  const { frame } = useAnimation({ interval: 80 });
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return (
    <Text color="yellow">
      {frames[frame % frames.length]!} {label}
    </Text>
  );
}

function WelcomeScreen({ model, sessionId }: { model: string; sessionId: string }) {
  return (
    <Box flexDirection="column" marginBottom={1} gap={1}>
      <Box flexDirection="row" gap={3} alignItems="flex-start">
        {/* Vole ASCII art */}
        <Box flexDirection="column">
          <Text color={VOLE_COLOR}>{"  (\\_/)"}</Text>
          <Text color={VOLE_COLOR}>{"  (•ᵥ•)"}</Text>
          <Text color={VOLE_COLOR}>{"  />  \\"}</Text>
        </Box>
        {/* Info */}
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={VOLE_COLOR} bold>{"vole"}</Text>
            <Text dimColor>{"— a capable coding and general-purpose agent"}</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{"model"}</Text>
              <Text>{model}</Text>
            </Box>
            <Text dimColor>{"·"}</Text>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{"session"}</Text>
              <Text color="blueBright">{sessionId.slice(-8)}</Text>
            </Box>
          </Box>
          <Text dimColor>{"Type /help for commands · /exit to leave"}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function CompactHeader({ model, sessionId }: { model: string; sessionId: string }) {
  return (
    <Box marginBottom={1} flexDirection="row" gap={2} alignItems="center">
      <Text color={VOLE_COLOR} bold>{"vole"}</Text>
      <Text dimColor>{"·"}</Text>
      <Text dimColor>{model}</Text>
      <Text dimColor>{"·"}</Text>
      <Text color="blueBright">{sessionId.slice(-8)}</Text>
      <Text dimColor>{"·  /help"}</Text>
    </Box>
  );
}

type SessionEntry = { id: string; title?: string; updatedAt: string };

function SessionPicker({
  sessions,
  selectedIndex,
  onSelect,
  onCancel,
}: {
  sessions: SessionEntry[];
  selectedIndex: number;
  onSelect: (s: SessionEntry) => void;
  onCancel: () => void;
}) {
  useInput((_, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return && sessions[selectedIndex] !== undefined) { onSelect(sessions[selectedIndex]!); return; }
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>{"No previous sessions found."}</Text>
        <Text dimColor>{"Esc  cancel"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor bold>{"Resume session  ↑↓ navigate · Enter select · Esc cancel"}</Text>
      {sessions.map((s, i) => {
        const label = s.title ?? s.id.slice(-12);
        const date  = s.updatedAt.slice(0, 16).replace("T", "  ");
        const active = i === selectedIndex;
        return (
          <Box key={s.id} gap={2}>
            {active
              ? <Text color={VOLE_COLOR} bold>{" ▶"}</Text>
              : <Text dimColor>{"  "}</Text>}
            <Text {...(active ? {} : { dimColor: true })}>{date}</Text>
            {active
              ? <Text color={VOLE_COLOR}>{label}</Text>
              : <Text>{label}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function StreamingMessage({ text }: { text: string }) {
  // Plain text during streaming — avoids ANSI height-calculation conflicts with
  // Ink's throttledLog, which can cause a pending trailing render to re-write
  // stale streaming text over the live area after the turn completes.
  // Full markdown is applied once the message is committed to Static.
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color="green" bold>{"Assistant"}</Text>
      <Box paddingLeft={2}>
        <Text>{text}</Text>
        <Text color="blueBright">{"▊"}</Text>
      </Box>
    </Box>
  );
}

function ToolProgress({ toolName, input }: { toolName: string; input?: unknown }) {
  const preview = input !== undefined
    ? (() => {
        try {
          const s = JSON.stringify(input);
          return s.length > 60 ? s.slice(0, 57) + "…" : s;
        } catch { return ""; }
      })()
    : "";
  return (
    <Box marginBottom={1} flexDirection="column">
      <Spinner label={`${toolName}`} />
      {preview !== "" && <Box paddingLeft={2}><Text dimColor>{preview}</Text></Box>}
    </Box>
  );
}

function TodosPanel({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  const done = todos.filter(t => t.status === "completed").length;
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor bold>{`Todo  ${done}/${todos.length}`}</Text>
      {todos.map((todo, i) => {
        const icon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "›" : "·";
        const color = todo.status === "completed" ? "green" : todo.status === "in_progress" ? "yellow" : undefined;
        return (
          <Box key={i}>
            {color !== undefined
              ? <Text color={color}>{icon} </Text>
              : <Text>{icon} </Text>}
            <Text dimColor={todo.status === "completed"}>{todo.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ApprovalPrompt({
  request,
  onApprove,
  onDeny
}: {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  useInput((inputChar) => {
    if (inputChar === "y" || inputChar === "Y") {
      onApprove();
    } else {
      onDeny();
    }
  });

  const inputPreview = (() => {
    try {
      const s = JSON.stringify(request.call.input, null, 2);
      const lines = s.split("\n");
      return lines.length > 6 ? lines.slice(0, 6).join("\n") + "\n  …" : s;
    } catch { return ""; }
  })();

  const riskColor = request.decision.risk === "high" ? "red" : request.decision.risk === "medium" ? "yellow" : "green";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text bold color="yellow">{"⚠  Approval Required"}</Text>
      <Box gap={1}>
        <Text dimColor>{"Tool:"}</Text>
        <Text bold>{request.call.name}</Text>
        <Text dimColor>{"·"}</Text>
        <Text dimColor>{"Risk:"}</Text>
        <Text color={riskColor} bold>{request.decision.risk}</Text>
      </Box>
      {inputPreview !== "" && (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Text dimColor>{"Input:"}</Text>
          <Box paddingLeft={2}><Text dimColor>{inputPreview}</Text></Box>
        </Box>
      )}
      <Text dimColor>{request.decision.reason}</Text>
      <Box marginTop={1}><Text color="yellow">{"  y  approve    any other key  deny"}</Text></Box>
    </Box>
  );
}

function SuggestionsBox({
  suggestions,
  selectedIndex
}: {
  suggestions: ReadonlyArray<{ command: string; description: string }>;
  selectedIndex: number;
}) {
  if (suggestions.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      {suggestions.map((s, i) => (
        <Box key={s.command} gap={2}>
          {i === selectedIndex ? (
            <Text color="cyan" bold>{s.command}</Text>
          ) : (
            <Text dimColor>{s.command}</Text>
          )}
          <Text dimColor>{s.description}</Text>
        </Box>
      ))}
      <Text dimColor>{"Tab · complete    ↑↓ · select"}</Text>
    </Box>
  );
}

// ─── Message types ─────────────────────────────────────────────────────────────

type ChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool_result"; toolName: string; content: string; ok: boolean }
  | { role: "error"; content: string }
  | { role: "slash_result"; command: string; lines: string[] };

// ─── Main App component ────────────────────────────────────────────────────────

interface ChatAppProps {
  config: EffectiveConfig;
  cliOptions: RunCliOptions;
  sessionId?: string;
}

function ChatApp({ config, cliOptions, sessionId }: ChatAppProps) {
  const { exit } = useApp();
  const { write: writeToStdout } = useStdout();

  // Session state
  const [session, setSession] = useState<CliChatSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(sessionId);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Input history — newest entry first
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");

  // Autocomplete
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  // Streaming state (current turn only)
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<{ name: string; input?: unknown } | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  // Session picker state (active while /resume is open)
  const [sessionPicker, setSessionPicker] = useState<{
    sessions: SessionEntry[];
    selectedIndex: number;
  } | null>(null);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (decision: ApprovalResolution) => void;
  } | null>(null);

  // Compute matching suggestions from current input
  const suggestions = useMemo(() => {
    if (!input.startsWith("/")) return [] as ReadonlyArray<{ command: string; description: string }>;
    if (input === "/") return SLASH_COMMANDS as ReadonlyArray<{ command: string; description: string }>;
    return SLASH_COMMANDS.filter(
      (c) => c.command.startsWith(input) && c.command !== input
    ) as ReadonlyArray<{ command: string; description: string }>;
  }, [input]);

  const showSuggestions = suggestions.length > 0;

  // Approval resolver that hooks into React state
  const inkApprovalResolver = useMemo(
    () => ({
      resolve: (request: ApprovalRequest): Promise<ApprovalResolution> =>
        new Promise<ApprovalResolution>((resolve) => {
          setPendingApproval({
            request,
            resolve: (decision) => {
              setPendingApproval(null);
              resolve(decision);
            }
          });
        })
    }),
    []
  );

  // Create session on mount
  useEffect(() => {
    CliChatSession.createConfigured(config, cliOptions, {
      approvalResolver: inkApprovalResolver,
      preferStreaming: true,
      ...(sessionId !== undefined ? { sessionId } : {})
    })
      .then((s) => {
        setSession(s);
        setActiveSessionId(s.sessionId);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to create session.");
      });
  }, [config, cliOptions, inkApprovalResolver, sessionId]);

  // Reset: close the current session and open a fresh one (new session ID → no message history).
  const resetSession = useCallback(async () => {
    session?.close();
    setSession(null);
    setMessages([]);
    setStreamingText("");
    setCurrentTool(null);
    setTodos([]);
    setPendingApproval(null);
    try {
      const s = await CliChatSession.createConfigured(config, cliOptions, {
        approvalResolver: inkApprovalResolver,
        preferStreaming: true
      });
      setSession(s);
      setActiveSessionId(s.sessionId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to reset session.");
    }
  }, [session, config, cliOptions, inkApprovalResolver]);

  // Resume: switch to an existing session by ID, restore visible conversation history.
  const handleResumeSession = useCallback(async (target: SessionEntry) => {
    setSessionPicker(null);
    session?.close();
    setSession(null);
    setMessages([]);
    setStreamingText("");
    setCurrentTool(null);
    setTodos([]);
    setPendingApproval(null);
    try {
      const s = await CliChatSession.createConfigured(config, cliOptions, {
        approvalResolver: inkApprovalResolver,
        preferStreaming: true,
        sessionId: target.id
      });
      // Restore visible conversation: user turns + assistant text responses.
      // Tool call records are omitted — they add noise without context in history view.
      const stored = await s.loadMessages();
      const history: ChatMessage[] = stored.flatMap<ChatMessage>((m) => {
        if (m.role === "user" && m.content) {
          return [{ role: "user", content: m.content }];
        }
        if (m.role === "assistant" && m.content) {
          return [{ role: "assistant", content: m.content }];
        }
        return [];
      });
      setMessages(history);
      setSession(s);
      setActiveSessionId(s.sessionId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to resume session.");
    }
  }, [session, config, cliOptions, inkApprovalResolver]);

  // Event callback for streaming
  const handleEvent = useCallback((event: RuntimeEvent) => {
    if (event.type === "token_delta") {
      setStreamingText((prev) => prev + event.delta);
    } else if (event.type === "tool_started") {
      setCurrentTool({ name: event.toolName });
    } else if (event.type === "tool_call_requested") {
      setCurrentTool({ name: event.call.name, input: event.call.input });
    } else if (event.type === "tool_completed") {
      setCurrentTool(null);
      // update_todos result is always {ok:true} — TodosPanel already shows the content.
      if (event.toolName === "update_todos") return;
      const resultText = renderToolResult(event.result);
      setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName, content: resultText, ok: true }]);
    } else if (event.type === "tool_failed") {
      setCurrentTool(null);
      setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName, content: event.error.message, ok: false }]);
    } else if (event.type === "todos_updated") {
      setTodos([...event.todos]);
    } else if (event.type === "run_failed") {
      setMessages((prev) => [...prev, { role: "error", content: event.error.message }]);
    }
  }, []);

  // Send a message turn
  const sendMessage = useCallback(
    async (message: string) => {
      if (session === null || isSending || message.trim() === "") return;
      const trimmed = message.trim();

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setIsSending(true);
      setStreamingText("");
      setCurrentTool(null);

      try {
        const turn = await session.sendMessage(trimmed, { onEvent: handleEvent });
        setStreamingText("");
        setCurrentTool(null);
        if (turn.assistantText !== "") {
          setMessages((prev) => [...prev, { role: "assistant", content: turn.assistantText }]);
        }
      } finally {
        setIsSending(false);
      }
    },
    [session, isSending, handleEvent]
  );

  // Run a slash command and append the result
  const handleSlashCommand = useCallback(
    async (command: string) => {
      if (session === null) return;
      if (command === "/resume") {
        const sessions = await session.listSessions({ limit: 20 });
        // Exclude the current session — no point resuming yourself
        const resumable = sessions.filter((s) => s.id !== session.sessionId);
        setSessionPicker({ sessions: resumable, selectedIndex: 0 });
        return;
      }
      if (command === "/clear") {
        // Clear terminal screen + start a fresh session (new session ID,
        // no message history — the model gets a clean context window).
        writeToStdout("\x1b[2J\x1b[H");
        void resetSession();
        return;
      }
      const lines = await session.runSlashCommand(command);
      setMessages((prev) => [...prev, { role: "slash_result", command, lines }]);
    },
    [session, writeToStdout, resetSession, handleResumeSession]
  );

  // Handle TextInput onChange — detects Tab (inserted as '\t') for autocomplete
  const handleChange = useCallback(
    (value: string) => {
      if (value.includes("\t")) {
        const base = value.replace(/\t/g, "");
        const filtered = base.startsWith("/")
          ? SLASH_COMMANDS.filter((c) => c.command.startsWith(base) && c.command !== base)
          : [];
        const target = filtered[suggestionIndex] ?? filtered[0];
        setInput(target !== undefined ? target.command : base);
        setSuggestionIndex(0);
        setHistoryIndex(-1);
      } else {
        setInput(value);
        setSuggestionIndex(0);
        setHistoryIndex(-1);
        setDraftInput(value);
      }
    },
    [suggestionIndex]
  );

  // ↑/↓ — navigate session picker when open; otherwise suggestions / input history
  useInput(
    (_, key) => {
      if (sessionPicker !== null) {
        if (key.upArrow) {
          setSessionPicker((p) => p && { ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) });
        } else if (key.downArrow) {
          setSessionPicker((p) => p && { ...p, selectedIndex: Math.min(p.sessions.length - 1, p.selectedIndex + 1) });
        }
        return;
      }
      if (key.upArrow) {
        if (showSuggestions) {
          setSuggestionIndex((i) => Math.max(0, i - 1));
        } else if (historyIndex < inputHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setInput(inputHistory[newIndex] ?? "");
        }
      } else if (key.downArrow) {
        if (showSuggestions) {
          setSuggestionIndex((i) => Math.min(suggestions.length - 1, i + 1));
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setInput(inputHistory[newIndex] ?? "");
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInput(draftInput);
        }
      }
    },
    { isActive: !isSending && pendingApproval === null }
  );

  // Ctrl+C exit handler
  useInput(
    (inputChar, key) => {
      if (key.ctrl && inputChar === "c") exit();
    },
    { isActive: true }
  );

  const handleSubmit = useCallback(
    (value: string) => {
      if (isSending || pendingApproval !== null) return;
      const trimmed = value.trim();
      if (trimmed === "") return;

      setInput("");
      setHistoryIndex(-1);
      setSuggestionIndex(0);

      if (trimmed === "/exit") { exit(); return; }

      if (trimmed.startsWith("/")) {
        void handleSlashCommand(trimmed);
        return;
      }

      // Track history for regular messages (newest first, no duplicates at head)
      setInputHistory((prev) => (prev[0] === trimmed ? prev : [trimmed, ...prev.slice(0, 49)]));
      void sendMessage(trimmed);
    },
    [isSending, pendingApproval, sendMessage, exit, handleSlashCommand]
  );

  if (loadError !== null) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>{"Error"}</Text>
        <Text>{loadError}</Text>
      </Box>
    );
  }

  if (session === null) {
    return (
      <Box padding={1}>
        <Spinner label="Starting Vole…" />
      </Box>
    );
  }

  const sidLabel = activeSessionId ?? "…";
  const modelLabel = `${config.model.provider}/${config.model.model}`;
  const hasMessages = messages.length > 0 || streamingText !== "" || currentTool !== null || isSending;

  return (
    <Box flexDirection="column">
      {/* Welcome screen (empty state) or compact header (active chat) */}
      {hasMessages
        ? <CompactHeader model={modelLabel} sessionId={sidLabel} />
        : <WelcomeScreen model={modelLabel} sessionId={sidLabel} />
      }

      {/* Past messages — Static prevents re-renders */}
      <Static items={messages}>
        {(msg, i) => {
          if (msg.role === "user") return (
            <Box key={i} marginBottom={1}>
              <Text color="cyan" bold>{"You  "}</Text>
              <Text>{msg.content}</Text>
            </Box>
          );
          if (msg.role === "tool_result") return (
            <Box key={i} flexDirection="column" marginBottom={1} paddingLeft={2}>
              <Box gap={1}>
                <Text color={msg.ok ? "green" : "red"}>{msg.ok ? "✓" : "✗"}</Text>
                <Text dimColor bold>{msg.toolName}</Text>
              </Box>
              <Box paddingLeft={2}><Text dimColor>{msg.content.slice(0, 200)}{msg.content.length > 200 ? " …" : ""}</Text></Box>
            </Box>
          );
          if (msg.role === "error") return (
            <Box key={i} marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
              <Text color="red" bold>{"✗ "}</Text>
              <Text color="red">{msg.content}</Text>
            </Box>
          );
          if (msg.role === "slash_result") return (
            <Box key={i} flexDirection="column" marginBottom={1} paddingLeft={2}>
              <Text color="blue" dimColor>{msg.command}</Text>
              {msg.lines.map((line, j) => (
                <Text key={j} dimColor>{line}</Text>
              ))}
            </Box>
          );
          // assistant
          return (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color="green" bold>{"Assistant"}</Text>
              <Box paddingLeft={2} flexDirection="column">
                <Markdown>{msg.content}</Markdown>
              </Box>
            </Box>
          );
        }}
      </Static>

      {/* Live streaming text */}
      {streamingText !== "" && <StreamingMessage text={streamingText} />}

      {/* Tool progress */}
      {currentTool !== null && <ToolProgress toolName={currentTool.name} input={currentTool.input} />}

      {/* Todos */}
      <TodosPanel todos={todos} />

      {/* Approval prompt */}
      {pendingApproval !== null && (
        <ApprovalPrompt
          request={pendingApproval.request}
          onApprove={() => pendingApproval.resolve({ approved: true, reason: "Approved from CLI." })}
          onDeny={() => pendingApproval.resolve({ approved: false, reason: "Denied from CLI." })}
        />
      )}

      {/* Session picker (shown while /resume is active) */}
      {sessionPicker !== null && (
        <SessionPicker
          sessions={sessionPicker.sessions}
          selectedIndex={sessionPicker.selectedIndex}
          onSelect={(s) => void handleResumeSession(s)}
          onCancel={() => setSessionPicker(null)}
        />
      )}

      {/* Autocomplete suggestions (above input) */}
      {!isSending && pendingApproval === null && sessionPicker === null && (
        <SuggestionsBox suggestions={suggestions} selectedIndex={suggestionIndex} />
      )}

      {/* Input row */}
      {!isSending && pendingApproval === null && sessionPicker === null && (
        <Box gap={1}>
          <Text color="cyan" bold>{"›"}</Text>
          <TextInput
            value={input}
            onChange={handleChange}
            onSubmit={handleSubmit}
            focus={pendingApproval === null && !isSending}
          />
        </Box>
      )}

      {/* Sending indicator */}
      {isSending && pendingApproval === null && (
        <Box gap={1}>
          <Spinner label="Thinking…" />
        </Box>
      )}
    </Box>
  );
}

// ─── Entry point called by main() ────────────────────────────────────────────

export interface InkChatArgs {
  args: string[];
  env: Record<string, string | undefined>;
  sessionsDirectory?: string;
}

export async function runInkChat({ args, env, sessionsDirectory }: InkChatArgs): Promise<void> {
  let config: EffectiveConfig;
  try {
    config = loadConfig({ env });
  } catch (err) {
    process.stderr.write(
      `Configuration error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exitCode = 1;
    return;
  }

  if (config.secrets.apiKey === undefined) {
    process.stderr.write(
      "Missing VOLE_API_KEY or OPENROUTER_API_KEY. Set one to start `vole chat`, or use `vole chat --fake-interactive` for local learning.\n"
    );
    process.exitCode = 1;
    return;
  }

  const sessionIndex = args.indexOf("--session");
  const sessionId =
    sessionIndex !== -1 && args[sessionIndex + 1] !== undefined
      ? args[sessionIndex + 1]
      : undefined;

  const cliOptions: RunCliOptions = {
    env,
    ...(sessionsDirectory !== undefined ? { sessionsDirectory } : {})
  };

  const { waitUntilExit } = render(
    <ChatApp
      config={config}
      cliOptions={cliOptions}
      {...(sessionId !== undefined ? { sessionId } : {})}
    />
  );

  await waitUntilExit();
}

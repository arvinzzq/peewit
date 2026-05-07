/**
 * INPUT: EffectiveConfig, env, session options (sessionId, resume flag).
 * OUTPUT: Ink-based interactive chat UI with streaming text, tool progress, approval prompts, todos panel, slash-command routing, input history (↑/↓), and Tab autocomplete.
 * POS: CLI Ink rendering layer; replaces readline stdout loop for real interactive sessions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { render, Box, Text, useInput, useApp, useAnimation, Static } from "ink";
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

// ─── Slash commands registry ──────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { command: "/help",   description: "Show available commands" },
  { command: "/trace",  description: "Show recent trace events" },
  { command: "/config", description: "Show redacted configuration" },
  { command: "/skills", description: "List loaded skills" },
  { command: "/clear",  description: "Clear conversation display" },
  { command: "/exit",   description: "Leave chat" },
] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  const { frame } = useAnimation({ interval: 80 });
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return (
    <Text color="yellow">
      {frames[frame % frames.length]!} {label}
    </Text>
  );
}

function StreamingMessage({ text }: { text: string }) {
  return (
    <Box marginBottom={1}>
      <Text color="green" bold>
        {"Assistant: "}
      </Text>
      <Text>{text}</Text>
      <Text dimColor>▊</Text>
    </Box>
  );
}

function ToolProgress({ toolName }: { toolName: string }) {
  return (
    <Box marginBottom={1}>
      <Spinner label={`Running ${toolName}…`} />
    </Box>
  );
}

function TodosPanel({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor bold>
        {"Tasks:"}
      </Text>
      {todos.map((todo, i) => (
        <Text key={i} dimColor>
          {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "→" : "·"}{" "}
          {todo.content}
        </Text>
      ))}
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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text bold color="yellow">
        {"⚠ Approval Required"}
      </Text>
      <Text>
        {"Tool: "}
        <Text bold>{request.call.name}</Text>
      </Text>
      <Text>
        {"Risk: "}
        <Text color="yellow">{request.decision.risk}</Text>
      </Text>
      <Text dimColor>{request.decision.reason}</Text>
      <Text color="yellow">{"Press y to approve, any other key to deny."}</Text>
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
        <Box key={s.command}>
          {i === selectedIndex ? (
            <Text color="cyan" bold>{s.command}</Text>
          ) : (
            <Text>{s.command}</Text>
          )}
          <Text dimColor>{`  ${s.description}`}</Text>
        </Box>
      ))}
      <Text dimColor>{"Tab to complete · ↑↓ to select"}</Text>
    </Box>
  );
}

// ─── Message types ─────────────────────────────────────────────────────────────

type ChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool_result"; toolName: string; content: string }
  | { role: "slash_result"; command: string; lines: string[] };

// ─── Main App component ────────────────────────────────────────────────────────

interface ChatAppProps {
  config: EffectiveConfig;
  cliOptions: RunCliOptions;
  sessionId?: string;
}

function ChatApp({ config, cliOptions, sessionId }: ChatAppProps) {
  const { exit } = useApp();

  // Session state
  const [session, setSession] = useState<CliChatSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);

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
      .then(setSession)
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to create session.");
      });
  }, [config, cliOptions, inkApprovalResolver, sessionId]);

  // Event callback for streaming
  const handleEvent = useCallback((event: RuntimeEvent) => {
    if (event.type === "token_delta") {
      setStreamingText((prev) => prev + event.delta);
    } else if (event.type === "tool_started") {
      setCurrentTool(event.toolName);
    } else if (event.type === "tool_completed") {
      setCurrentTool(null);
      const resultText = renderToolResult(event.result);
      setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName, content: resultText }]);
    } else if (event.type === "tool_failed") {
      setCurrentTool(null);
      setMessages((prev) => [...prev, { role: "tool_result", toolName: event.toolName, content: `Error: ${event.error.message}` }]);
    } else if (event.type === "todos_updated") {
      setTodos([...event.todos]);
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
        setMessages((prev) => [...prev, { role: "assistant", content: turn.assistantText }]);
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
      if (command === "/clear") {
        setMessages([]);
        return;
      }
      const lines = await session.runSlashCommand(command);
      setMessages((prev) => [...prev, { role: "slash_result", command, lines }]);
    },
    [session]
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

  // ↑/↓ — navigate suggestions when autocomplete is open, history otherwise
  useInput(
    (inputChar, key) => {
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
      <Box>
        <Text color="red">{"Error: "}</Text>
        <Text>{loadError}</Text>
      </Box>
    );
  }

  if (session === null) {
    return (
      <Box>
        <Spinner label="Loading Vole…" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Static header — rendered once */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold>{"Vole chat"}</Text>
        <Text dimColor>{"Type /help for commands or /exit to leave."}</Text>
      </Box>

      {/* Past messages — Static prevents re-renders */}
      <Static items={messages}>
        {(msg, i) =>
          msg.role === "user" ? (
            <Box key={i} marginBottom={1}>
              <Text color="cyan" bold>{"You: "}</Text>
              <Text>{msg.content}</Text>
            </Box>
          ) : msg.role === "tool_result" ? (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color="yellow" dimColor>{`▶ ${msg.toolName}`}</Text>
              <Text dimColor>{msg.content}</Text>
            </Box>
          ) : msg.role === "slash_result" ? (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color="blue" dimColor>{msg.command}</Text>
              {msg.lines.map((line, j) => (
                <Text key={j} dimColor>{line}</Text>
              ))}
            </Box>
          ) : (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color="green" bold>{"Assistant:"}</Text>
              <Text>{msg.content}</Text>
            </Box>
          )
        }
      </Static>

      {/* Live streaming text */}
      {streamingText !== "" && <StreamingMessage text={streamingText} />}

      {/* Tool progress */}
      {currentTool !== null && <ToolProgress toolName={currentTool} />}

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

      {/* Autocomplete suggestions (above input) */}
      {!isSending && pendingApproval === null && (
        <SuggestionsBox suggestions={suggestions} selectedIndex={suggestionIndex} />
      )}

      {/* Input box — shown when idle */}
      {!isSending && pendingApproval === null && (
        <Box>
          <Text color="cyan" bold>{"> "}</Text>
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
        <Box>
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

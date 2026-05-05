/**
 * INPUT: EffectiveConfig, env, session options (sessionId, resume flag).
 * OUTPUT: Ink-based interactive chat UI with streaming text, tool progress, approval prompts, and todos panel.
 * POS: CLI Ink rendering layer; replaces readline stdout loop for real interactive sessions.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { render, Box, Text, useInput, useApp, useAnimation, Static } from "ink";
import { loadConfig, type EffectiveConfig } from "@arvinclaw/config";
import type { RuntimeEvent } from "@arvinclaw/core";
import type { TodoItem } from "@arvinclaw/tools";
import {
  CliChatSession,
  type ApprovalRequest,
  type ApprovalResolution,
  type RunCliOptions
} from "./index.js";

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

// ─── Message types ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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

  // Streaming state (current turn only)
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (decision: ApprovalResolution) => void;
  } | null>(null);

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
    } else if (event.type === "tool_completed" || event.type === "tool_failed") {
      setCurrentTool(null);
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

  // Keyboard input handler
  useInput(
    (inputChar, key) => {
      // Approval input takes priority
      if (pendingApproval !== null) {
        return; // handled by ApprovalPrompt's own useInput
      }

      if (isSending) return;

      if (key.return) {
        const trimmed = input.trim();
        if (trimmed === "/exit") {
          exit();
          return;
        }
        if (trimmed !== "") {
          void sendMessage(trimmed);
        }
        setInput("");
      } else if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
      } else if (key.escape) {
        setInput("");
      } else if (key.ctrl && inputChar === "c") {
        exit();
      } else if (!key.ctrl && !key.meta && inputChar) {
        setInput((prev) => prev + inputChar);
      }
    },
    { isActive: pendingApproval === null && !isSending }
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
        <Spinner label="Loading ArvinClaw…" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Static header — rendered once */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold>{"ArvinClaw chat"}</Text>
        <Text dimColor>{"Type /exit to leave."}</Text>
      </Box>

      {/* Past messages — Static prevents re-renders */}
      <Static items={messages}>
        {(msg, i) =>
          msg.role === "user" ? (
            <Box key={i} marginBottom={1}>
              <Text color="cyan" bold>
                {"You: "}
              </Text>
              <Text>{msg.content}</Text>
            </Box>
          ) : (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color="green" bold>
                {"Assistant:"}
              </Text>
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

      {/* Input box — shown when idle */}
      {!isSending && pendingApproval === null && (
        <Box>
          <Text color="cyan" bold>
            {"> "}
          </Text>
          <Text>{input}</Text>
          <Text dimColor>{"▊"}</Text>
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
      "Missing ARVINCLAW_API_KEY or OPENROUTER_API_KEY. Set one to start `arvinclaw chat`, or use `arvinclaw chat --fake-interactive` for local learning.\n"
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

# Context Compaction

Status: Design
Date: 2026-05-05

Simplified Chinese version: [context-compaction.zh-CN.md](./context-compaction.zh-CN.md)

## 1. Purpose

As a session grows, the accumulated conversation messages eventually approach the model's context window limit. Without compaction, long-running agent sessions fail with context-overflow errors or silently drop early messages.

Context compaction solves this by summarizing older portions of the conversation history, replacing them with a compact summary while keeping recent messages verbatim. This allows sessions of arbitrary length while preserving the most actionable recent context.

The core rule:

Compaction is a lossless-by-intent operation — the summary must capture all decisions, tool results, and state needed to continue the task. If compaction cannot be done safely, the original messages are returned unchanged.

## 2. Trigger Condition

Compaction is triggered before each model request when the current message list exceeds the configured `maxMessages` threshold.

The threshold is intentionally set before the hard context window limit to leave room for:

- The system prompt
- Incoming tool results
- The next model response

Default value: `maxMessages: 200`. This is tunable via `CompactionOptions`.

Compaction does not run on every turn — only when the threshold is crossed. The check is O(1): compare `messages.length` against `maxMessages`.

## 3. Compaction Algorithm

When triggered, the compaction algorithm proceeds as follows:

1. Partition messages into two groups:
   - **Old messages**: messages from index `0` to `messages.length - keepRecent - 1`
   - **Recent messages**: the last `keepRecent` messages (verbatim, never compacted)

2. Call the summary model using `summarySystemPrompt` plus the old messages as input. The summary model may be the same model or a cheaper variant.

3. If the summary call succeeds, replace the old messages with a single synthetic assistant message containing the summary text.

4. Return: `[summaryMessage, ...recentMessages]`

If the old message block is empty (i.e., `messages.length <= keepRecent`), skip compaction and return messages unchanged.

## 4. CompactionOptions Interface

```typescript
interface CompactionOptions {
  /** Trigger compaction when message count exceeds this value. Default: 200 */
  maxMessages: number;

  /** Number of recent messages to keep verbatim. Default: 20 */
  keepRecent: number;

  /** System prompt injected when generating the summary. */
  summarySystemPrompt: string;
}
```

The `summarySystemPrompt` should instruct the model to produce a concise factual summary capturing:

- The original task or goal
- Key decisions made
- Tool calls and their outcomes
- Current state and open questions
- Any constraints or instructions that remain active

## 5. Integration with AgentRuntime

`AgentRuntime` calls `compactIfNeeded(messages, options)` at the start of `buildModelRequest()`, before assembling the final context.

The flow:

```
runTurn()
  -> buildModelRequest()
       -> compactIfNeeded(messages, options)   // <- compaction hook
       -> assembleContext(compactedMessages)
       -> model.complete(request)
```

Compaction is transparent to the rest of the loop. The tool executor, permission system, and trace system observe no difference.

A trace event `context_compacted` is emitted after successful compaction, recording:

- Original message count
- Messages after compaction
- Summary length in characters
- Whether keepRecent was honored

## 6. Fail-Safe

If the summary model call fails for any reason (network error, model refusal, timeout), the compaction function catches the error, logs a warning trace event, and returns the **original messages unchanged**.

The agent turn continues with the full uncompacted message list. This is safer than failing the turn or silently truncating messages.

The fail-safe rule:

Compaction failure must never cause an agent turn to fail. Degraded context is better than no response.

## 7. OpenClaw Alignment

OpenClaw implements context compaction as part of its `context-engine-maintenance` subsystem. Key alignments:

| OpenClaw concept | ArvinClaw equivalent |
| --- | --- |
| `context-engine-maintenance` | `compactIfNeeded()` in `AgentRuntime` |
| Hard limit threshold | `maxMessages` in `CompactionOptions` |
| Summary injection | Synthetic assistant message prepended to recent messages |
| Fail-safe passthrough | Error catch + return original messages |

OpenClaw's compaction also tracks a `compactionCount` per session for observability. ArvinClaw should do the same via trace events.

## 8. Acceptance Criteria

Context compaction is considered complete when:

- `compactIfNeeded()` triggers only when `messages.length > maxMessages`.
- Recent messages (`keepRecent`) are always preserved verbatim.
- Summary is inserted as a synthetic message at position 0 after compaction.
- A `context_compacted` trace event is emitted on success.
- If the summary model call fails, original messages are returned unchanged.
- Compaction integrates into `AgentRuntime.buildModelRequest()` without changing the tool or permission pipeline.
- Unit tests cover: trigger condition, summary injection, fail-safe, keepRecent boundary.

## 9. Related Documents

- [Agent Loop](./agent-loop.md)
- [Context Engine](./context-engine.md)
- [Session Storage](./session-storage.md)
- [Execution Trace](./execution-trace.md)
- [Skill System](./skill-system.md)
- [OpenClaw Implementation Notes](../research/openclaw-implementation-notes.md)
- [Roadmap](../roadmap/overview.md)

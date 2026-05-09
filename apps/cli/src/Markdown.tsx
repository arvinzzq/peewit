/**
 * INPUT: markdown string (static or streaming)
 * OUTPUT: Ink Text component with ANSI-formatted terminal output
 * POS: CLI rendering layer; used by ChatApp for assistant messages and streaming text.
 */
import { marked } from "marked";
import React, { useRef } from "react";
import { Text } from "ink";
import { markdownToAnsi, configureMarked } from "./markdownFormat.js";

/** Renders a complete markdown string as rich ANSI terminal output. */
export function Markdown({ children }: { children: string }): React.ReactNode {
  return <Text>{markdownToAnsi(children)}</Text>;
}

/**
 * Renders markdown during streaming by splitting at the last complete block boundary.
 * Only the final incomplete block is re-parsed per delta — everything before is stable.
 * Mirrors the algorithm in Claude Code's StreamingMarkdown component.
 */
export function StreamingMarkdown({ children }: { children: string }): React.ReactNode {
  "use no memo";

  configureMarked();

  const stablePrefixRef = useRef("");

  if (!children.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = "";
  }

  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(children.substring(boundary));

  // Last non-space token is the still-growing block; everything before it is final.
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === "space") {
    lastContentIdx--;
  }

  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = children.substring(0, boundary + advance);
  }

  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = children.substring(stablePrefix.length);

  return (
    <>
      {stablePrefix && <Markdown>{stablePrefix}</Markdown>}
      {unstableSuffix && <Markdown>{unstableSuffix}</Markdown>}
    </>
  );
}

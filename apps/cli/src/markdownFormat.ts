/**
 * INPUT: markdown string
 * OUTPUT: ANSI-formatted string (chalk SGR sequences, passes through Ink's sanitizeAnsi)
 * POS: markdown-to-terminal rendering utility; used by Markdown and StreamingMarkdown components.
 */
import chalk from "chalk";
import { marked, type Token, type Tokens } from "marked";

let configured = false;

export function configureMarked(): void {
  if (configured) return;
  configured = true;
  // Disable strikethrough — model uses ~ for "approximately", rarely for ~~strike~~.
  marked.use({
    tokenizer: {
      del() { return undefined as never; }
    }
  });
}

/** Convert a single marked Token to an ANSI string. */
export function formatToken(token: Token, listDepth = 0, ordered = false): string {
  switch (token.type) {
    case "heading": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      if (token.depth === 1) return chalk.bold.underline(inner) + "\n\n";
      if (token.depth === 2) return chalk.bold(inner) + "\n\n";
      return chalk.bold(chalk.dim(inner)) + "\n\n";
    }
    case "paragraph": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      return inner + "\n\n";
    }
    case "strong": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      return chalk.bold(inner);
    }
    case "em": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      return chalk.italic(inner);
    }
    case "del": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      return chalk.strikethrough(inner);
    }
    case "codespan": {
      return chalk.yellow(token.text);
    }
    case "code": {
      const lines = token.text.split("\n");
      const formatted = lines.map((line: string) => "  " + chalk.yellow(line)).join("\n");
      return chalk.dim("```" + (token.lang ?? "")) + "\n" + formatted + "\n" + chalk.dim("```") + "\n\n";
    }
    case "blockquote": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("").trim();
      return inner.split("\n").map((line: string) => chalk.dim("│ ") + chalk.italic(line)).join("\n") + "\n\n";
    }
    case "list": {
      const items = (token.items ?? []).map((item: Tokens.ListItem, i: number) => {
        const prefix = token.ordered ? chalk.bold(`${i + 1}.`) + " " : chalk.bold("•") + " ";
        const indent = "  ".repeat(listDepth);
        const body = (item.tokens ?? [])
          .map((t: Token) => {
            if (t.type === "list") return "\n" + formatToken(t, listDepth + 1);
            return formatToken(t, listDepth);
          })
          .join("")
          .trim();
        return indent + prefix + body;
      });
      return items.join("\n") + "\n\n";
    }
    case "hr": {
      return chalk.dim("─".repeat(40)) + "\n\n";
    }
    case "link": {
      const label = (token.tokens ?? []).map((t) => formatToken(t)).join("") || token.text;
      if (token.href && token.href !== label) {
        return label + chalk.dim(` (${token.href})`);
      }
      return label;
    }
    case "image": {
      return chalk.dim(`[image: ${token.text}]`);
    }
    case "html": {
      // Strip HTML tags; show plain inner text
      return token.text.replace(/<[^>]+>/g, "");
    }
    case "text": {
      const inner = (token.tokens ?? []).map((t) => formatToken(t)).join("");
      return inner || token.text;
    }
    case "space": {
      return "\n";
    }
    case "escape": {
      return token.text;
    }
    case "table": {
      // Minimal table: header | rows
      const sep = chalk.dim(" | ");
      const header = (token.header ?? []).map((cell: Tokens.TableCell) =>
        chalk.bold((cell.tokens ?? []).map((t: Token) => formatToken(t)).join(""))
      ).join(sep);
      const divider = chalk.dim("─".repeat(Math.max(header.length - (sep.length * ((token.header?.length ?? 1) - 1)), 20)));
      const rows = (token.rows ?? []).map((row: Tokens.TableCell[]) =>
        row.map((cell: Tokens.TableCell) => (cell.tokens ?? []).map((t: Token) => formatToken(t)).join("")).join(sep)
      );
      return [header, divider, ...rows].join("\n") + "\n\n";
    }
    default: {
      const t = token as { text?: string; raw?: string };
      return t.text ?? t.raw ?? "";
    }
  }
}

/** Convert a full markdown string to an ANSI-formatted terminal string. */
export function markdownToAnsi(content: string): string {
  configureMarked();
  const tokens = marked.lexer(content);
  return tokens.map((t) => formatToken(t)).join("").trimEnd();
}

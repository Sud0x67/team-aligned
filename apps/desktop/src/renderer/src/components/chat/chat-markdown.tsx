import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; depth: number; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "hr" };

function isFence(line: string) {
  return line.trim().startsWith("```");
}

function isHorizontalRule(line: string) {
  return /^(\s*)(-{3,}|\*{3,}|_{3,})(\s*)$/.test(line);
}

function isHeading(line: string) {
  return /^(#{1,6})\s+(.+)$/.test(line);
}

function isUnorderedListItem(line: string) {
  return /^\s*[-*+]\s+.+$/.test(line);
}

function isOrderedListItem(line: string) {
  return /^\s*\d+[.)]\s+.+$/.test(line);
}

function isBlockquote(line: string) {
  return /^\s*>\s?.*$/.test(line);
}

function isBlockStart(line: string) {
  return (
    isFence(line) ||
    isHorizontalRule(line) ||
    isHeading(line) ||
    isUnorderedListItem(line) ||
    isOrderedListItem(line) ||
    isBlockquote(line)
  );
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isFence(line)) {
      const language = line.trim().slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        depth: headingMatch[1].length,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (isUnorderedListItem(line)) {
      const items: string[] = [];
      while (index < lines.length && isUnorderedListItem(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    if (isOrderedListItem(line)) {
      const items: string[] = [];
      while (index < lines.length && isOrderedListItem(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && isBlockquote(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return value.startsWith("/") || value.startsWith("#") ? value : null;
  }
}

function renderInlineSegment(text: string, keyPrefix: string, inverted: boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className={`rounded-md px-1.5 py-0.5 font-mono text-[0.88em] ${
            inverted ? "bg-white/20 text-white" : "bg-[var(--card)] text-[var(--foreground)]"
          }`}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = linkMatch ? safeHref(linkMatch[2].trim()) : null;
      if (linkMatch && href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-current/40 underline-offset-4 transition hover:decoration-current"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderInlineText(text: string, keyPrefix: string, inverted: boolean) {
  return text.split("\n").flatMap((line, index) => {
    const renderedLine = renderInlineSegment(line, `${keyPrefix}-${index}`, inverted);
    return index === 0 ? renderedLine : [<br key={`${keyPrefix}-br-${index}`} />, ...renderedLine];
  });
}

export function ChatMarkdownContent({
  content,
  inverted = false,
}: {
  content: string;
  inverted?: boolean;
}) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const headingClass =
            block.depth <= 2
              ? "text-[1.08em] font-semibold leading-7"
              : "text-[1em] font-semibold leading-7";
          return (
            <p key={index} className={headingClass}>
              {renderInlineText(block.text, `heading-${index}`, inverted)}
            </p>
          );
        }

        if (block.type === "unordered-list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineText(item, `ul-${index}-${itemIndex}`, inverted)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineText(item, `ol-${index}-${itemIndex}`, inverted)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={index}
              className={`border-l-2 py-0.5 pl-3 ${
                inverted ? "border-white/40 text-white/85" : "border-[var(--primary)] text-[var(--muted-foreground)]"
              }`}
            >
              {renderInlineText(block.text, `quote-${index}`, inverted)}
            </blockquote>
          );
        }

        if (block.type === "code") {
          return (
            <div key={index} className="space-y-1">
              {block.language ? (
                <div className={inverted ? "text-[11px] text-white/70" : "text-[11px] text-[var(--muted-foreground)]"}>
                  {block.language}
                </div>
              ) : null}
              <pre
                className={`max-w-full overflow-x-auto rounded-xl border px-3 py-2 font-mono text-[12px] leading-6 ${
                  inverted
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
                }`}
              >
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "hr") {
          return <hr key={index} className={inverted ? "border-white/20" : "border-[var(--border)]"} />;
        }

        return (
          <p key={index}>
            {renderInlineText(block.text, `p-${index}`, inverted)}
          </p>
        );
      })}
    </div>
  );
}

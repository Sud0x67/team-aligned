import type { ReactNode } from "react";
import { parseChatMarkdown } from "./chat-markdown-parser";
import { reportRendererError } from "../../error-reporting";

const MAX_INLINE_SEGMENTS = 800;
const MAX_INLINE_LINES = 1_000;

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
    if (nodes.length >= MAX_INLINE_SEGMENTS) {
      nodes.push(text.slice(cursor));
      return nodes;
    }
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderInlineText(text: string, keyPrefix: string, inverted: boolean) {
  return text.split("\n").slice(0, MAX_INLINE_LINES).flatMap((line, index) => {
    const renderedLine = renderInlineSegment(line, `${keyPrefix}-${index}`, inverted);
    return index === 0 ? renderedLine : [<br key={`${keyPrefix}-br-${index}`} />, ...renderedLine];
  });
}

function PlainTextFallback({ content }: { content: string }) {
  return <p className="whitespace-pre-wrap">{content}</p>;
}

export function ChatMarkdownContent({
  content,
  inverted = false,
}: {
  content: string;
  inverted?: boolean;
}) {
  let blocks: ReturnType<typeof parseChatMarkdown>;
  try {
    blocks = parseChatMarkdown(content);
  } catch (error) {
    reportRendererError("chat-markdown:parse", error, {
      contentLength: content.length,
    });
    return <PlainTextFallback content={content} />;
  }
  if (blocks.length === 0) return null;

  try {
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

        if (block.type === "table") {
          return (
            <div key={index} className="max-w-full overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full border-collapse text-left text-[0.92em]">
                <thead className={inverted ? "bg-white/10" : "bg-[var(--card)]"}>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={headerIndex}
                        className={`border-b px-3 py-2 font-semibold ${
                          inverted ? "border-white/20 text-white" : "border-[var(--border)] text-[var(--foreground)]"
                        }`}
                      >
                        {renderInlineText(header, `table-${index}-h-${headerIndex}`, inverted)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.headers.map((_, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`border-t px-3 py-2 align-top ${
                            inverted ? "border-white/15 text-white/90" : "border-[var(--border)] text-[var(--foreground)]"
                          }`}
                        >
                          {renderInlineText(row[cellIndex] ?? "", `table-${index}-${rowIndex}-${cellIndex}`, inverted)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
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
  } catch (error) {
    reportRendererError("chat-markdown:render", error, {
      contentLength: content.length,
      blockCount: blocks.length,
    });
    return <PlainTextFallback content={content} />;
  }
}

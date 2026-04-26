export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; depth: number; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
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

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableRow(line: string) {
  return line.includes("|") && line.trim().replace(/\|/g, "").trim().length > 0;
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isBlockStart(line: string) {
  return (
    isFence(line) ||
    isHorizontalRule(line) ||
    isHeading(line) ||
    isUnorderedListItem(line) ||
    isOrderedListItem(line) ||
    isBlockquote(line) ||
    isTableSeparator(line)
  );
}

export function parseChatMarkdown(content: string): MarkdownBlock[] {
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

    const nextLine = lines[index + 1] ?? "";
    if (isTableRow(line) && isTableSeparator(nextLine)) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        rows.push(parseTableRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
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

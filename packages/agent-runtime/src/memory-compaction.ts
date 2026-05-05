import { readFileSync, writeFileSync } from "node:fs";

export const memoryEntryStartMarker = "<!-- teamaligned-memory-entry:start -->";
export const memoryEntryEndMarker = "<!-- teamaligned-memory-entry:end -->";
export const memorySummaryStartMarker = "<!-- teamaligned-memory-summary:start -->";
export const memorySummaryEndMarker = "<!-- teamaligned-memory-summary:end -->";

export const defaultMemoryCompactionOptions = {
  maxChars: 64 * 1024,
  summaryMaxChars: 32 * 1024,
  keepRecentEntries: 20,
};

export type MemoryEntryInput = {
  timestamp: string;
  kind: "agent" | "team";
  inputLabel: string;
  input: string;
  outputLabel: string;
  output: string;
  speakerLabel?: string;
  speakers?: string[];
};

export type MemoryCompactionSummaryInput = {
  existingSummary: string;
  contentToSummarize: string;
  maxSummaryChars: number;
};

export type MemoryCompactionResult = {
  compacted: boolean;
  content: string;
  originalChars: number;
  compactedChars: number;
  keptEntryCount: number;
  summarizedEntryCount: number;
};

type MemorySection = {
  content: string;
  raw: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSectionRegExp(startMarker: string, endMarker: string) {
  return new RegExp(
    `${escapeRegExp(startMarker)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(endMarker)}`,
    "g",
  );
}

function extractSections(content: string, startMarker: string, endMarker: string) {
  const sections: MemorySection[] = [];
  const pattern = createSectionRegExp(startMarker, endMarker);
  for (const match of content.matchAll(pattern)) {
    sections.push({
      content: match[1]?.trim() ?? "",
      raw: match[0],
    });
  }
  return sections;
}

function removeSections(content: string, startMarker: string, endMarker: string) {
  return content.replace(createSectionRegExp(startMarker, endMarker), "").trim();
}

function splitHeader(content: string, fallbackTitle: string) {
  const normalized = content.trimStart();
  const match = normalized.match(/^# .*(?:\r?\n){1,2}/);
  if (match) {
    return {
      header: match[0].endsWith("\n\n") ? match[0] : `${match[0].trimEnd()}\n\n`,
      body: normalized.slice(match[0].length).trim(),
    };
  }
  return {
    header: `# ${fallbackTitle}\n\n`,
    body: normalized.trim(),
  };
}

function markdownFenceFor(content: string) {
  const fences = content.match(/`{3,}/g) ?? [];
  const maxFenceLength = fences.reduce((max, fence) => Math.max(max, fence.length), 2);
  return "`".repeat(maxFenceLength + 1);
}

function fencedText(content: string) {
  const value = content.length > 0 ? content : "(empty)";
  const fence = markdownFenceFor(value);
  return `${fence}text\n${value}\n${fence}`;
}

function capText(content: string, maxChars: number) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[Memory summary truncated to ${maxChars} characters.]`;
}

export function formatMemoryEntry(input: MemoryEntryInput) {
  const speakerLine =
    input.speakers && input.speakers.length > 0
      ? [`${input.speakerLabel ?? "Speakers"}: ${input.speakers.join(", ")}`, ""]
      : [];

  return [
    memoryEntryStartMarker,
    `Timestamp: ${input.timestamp}`,
    `Kind: ${input.kind}`,
    ...speakerLine,
    `### ${input.inputLabel}`,
    "",
    fencedText(input.input),
    "",
    `### ${input.outputLabel}`,
    "",
    fencedText(input.output),
    memoryEntryEndMarker,
  ].join("\n");
}

export async function compactMemoryContent(
  content: string,
  input: {
    title: string;
    summarize: (summaryInput: MemoryCompactionSummaryInput) => Promise<string>;
    maxChars?: number;
    summaryMaxChars?: number;
    keepRecentEntries?: number;
    now?: Date;
  },
): Promise<MemoryCompactionResult> {
  const maxChars = input.maxChars ?? defaultMemoryCompactionOptions.maxChars;
  const summaryMaxChars =
    input.summaryMaxChars ?? defaultMemoryCompactionOptions.summaryMaxChars;
  const keepRecentEntries =
    input.keepRecentEntries ?? defaultMemoryCompactionOptions.keepRecentEntries;

  if (content.length <= maxChars) {
    return {
      compacted: false,
      content,
      originalChars: content.length,
      compactedChars: content.length,
      keptEntryCount: extractSections(content, memoryEntryStartMarker, memoryEntryEndMarker).length,
      summarizedEntryCount: 0,
    };
  }

  const { header, body } = splitHeader(content, input.title);
  const existingSummary = extractSections(
    body,
    memorySummaryStartMarker,
    memorySummaryEndMarker,
  )
    .map((section) => section.content)
    .filter(Boolean)
    .join("\n\n");
  const bodyWithoutSummary = removeSections(
    body,
    memorySummaryStartMarker,
    memorySummaryEndMarker,
  );
  const entries = extractSections(
    bodyWithoutSummary,
    memoryEntryStartMarker,
    memoryEntryEndMarker,
  );
  const unmarkedContent = removeSections(
    bodyWithoutSummary,
    memoryEntryStartMarker,
    memoryEntryEndMarker,
  );
  const recentEntries = entries.slice(-keepRecentEntries);
  const oldEntries = entries.slice(0, Math.max(0, entries.length - keepRecentEntries));
  const contentToSummarize = [
    existingSummary ? `Existing compacted summary:\n${existingSummary}` : "",
    unmarkedContent ? `Unmarked legacy memory:\n${unmarkedContent}` : "",
    oldEntries.length > 0
      ? `Older raw memory entries:\n${oldEntries.map((entry) => entry.raw).join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!contentToSummarize.trim()) {
    return {
      compacted: false,
      content,
      originalChars: content.length,
      compactedChars: content.length,
      keptEntryCount: entries.length,
      summarizedEntryCount: 0,
    };
  }

  const summary = capText(
    (
      await input.summarize({
        existingSummary,
        contentToSummarize,
        maxSummaryChars: summaryMaxChars,
      })
    ).trim(),
    summaryMaxChars,
  );
  if (!summary) {
    throw new Error("Memory compaction produced an empty summary");
  }

  const updatedAt = (input.now ?? new Date()).toISOString();
  const nextBody = [
    memorySummaryStartMarker,
    `## Compacted Memory Summary`,
    "",
    `Updated: ${updatedAt}`,
    `Summarized entries: ${oldEntries.length}`,
    "",
    summary,
    memorySummaryEndMarker,
    "",
    ...recentEntries.map((entry) => entry.raw),
  ]
    .filter(Boolean)
    .join("\n\n");
  const nextContent = `${header}${nextBody.trim()}\n`;

  return {
    compacted: true,
    content: nextContent,
    originalChars: content.length,
    compactedChars: nextContent.length,
    keptEntryCount: recentEntries.length,
    summarizedEntryCount: oldEntries.length,
  };
}

export async function compactMemoryFile(
  filePath: string,
  input: {
    title: string;
    summarize: (summaryInput: MemoryCompactionSummaryInput) => Promise<string>;
    maxChars?: number;
    summaryMaxChars?: number;
    keepRecentEntries?: number;
    now?: Date;
  },
) {
  const content = readFileSync(filePath, "utf8");
  const result = await compactMemoryContent(content, input);
  if (result.compacted) {
    writeFileSync(filePath, result.content, "utf8");
  }
  return result;
}

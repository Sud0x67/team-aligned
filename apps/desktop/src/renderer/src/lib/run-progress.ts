const ZH_ELAPSED_SECONDS_PATTERN = /已用时\s*(\d+)\s*秒/;
const EN_ELAPSED_SECONDS_PATTERN = /elapsed\s+(\d+)\s+seconds?/i;

export function formatElapsedDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

export function refreshProgressElapsedText(
  content: string,
  progressCreatedAt: number | null,
  now: number,
) {
  if (!progressCreatedAt || progressCreatedAt > now) {
    return content;
  }

  const extraSeconds = Math.floor((now - progressCreatedAt) / 1000);
  if (extraSeconds <= 0) {
    return content;
  }

  return content
    .replace(ZH_ELAPSED_SECONDS_PATTERN, (_match, seconds: string) => {
      return `已用时 ${Number(seconds) + extraSeconds} 秒`;
    })
    .replace(EN_ELAPSED_SECONDS_PATTERN, (_match, seconds: string) => {
      return `elapsed ${Number(seconds) + extraSeconds} seconds`;
    });
}

export function formatActiveRunProgressText(latestProgress: unknown, now: number) {
  if (!latestProgress || typeof latestProgress !== "object") {
    return null;
  }
  const record = latestProgress as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content) {
    return null;
  }
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : null;
  return refreshProgressElapsedText(content, createdAt, now);
}

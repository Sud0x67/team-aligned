import test from "node:test";
import assert from "node:assert/strict";
import {
  formatActiveRunProgressText,
  formatElapsedDuration,
  refreshProgressElapsedText,
} from "./run-progress.ts";

test("formatElapsedDuration renders compact mm:ss and h:mm:ss labels", () => {
  assert.equal(formatElapsedDuration(0), "00:00");
  assert.equal(formatElapsedDuration(146_000), "02:26");
  assert.equal(formatElapsedDuration(3_661_000), "1:01:01");
});

test("refreshProgressElapsedText advances Chinese model waiting elapsed seconds", () => {
  const createdAt = 1_000;
  const now = createdAt + 26_000;

  assert.equal(
    refreshProgressElapsedText("Designer 仍在等待模型返回，已用时 120 秒。", createdAt, now),
    "Designer 仍在等待模型返回，已用时 146 秒。",
  );
});

test("refreshProgressElapsedText advances English model waiting elapsed seconds", () => {
  const createdAt = 10_000;
  const now = createdAt + 7_000;

  assert.equal(
    refreshProgressElapsedText("Designer is still waiting for the model, elapsed 120 seconds.", createdAt, now),
    "Designer is still waiting for the model, elapsed 127 seconds.",
  );
});

test("formatActiveRunProgressText keeps non-elapsed progress unchanged", () => {
  assert.equal(
    formatActiveRunProgressText(
      {
        content: "Designer is calling the model and waiting for the streamed reply.",
        createdAt: 1_000,
      },
      30_000,
    ),
    "Designer is calling the model and waiting for the streamed reply.",
  );
});

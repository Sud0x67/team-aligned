import test from "node:test";
import assert from "node:assert/strict";
import { parseChatMarkdown } from "./chat-markdown-parser.ts";

test("parseChatMarkdown supports common chat markdown blocks", () => {
  const blocks = parseChatMarkdown(
    [
      "# Summary",
      "",
      "- first",
      "- **second**",
      "",
      "| Name | Status |",
      "| --- | --- |",
      "| Coder | `ready` |",
      "| Designer | reviewing |",
      "",
      "```ts",
      "const ok = true;",
      "```",
    ].join("\n"),
  );

  assert.equal(blocks[0]?.type, "heading");
  assert.equal(blocks[1]?.type, "unordered-list");
  assert.equal(blocks[2]?.type, "table");
  assert.deepEqual(
    blocks[2]?.type === "table" ? blocks[2].headers : [],
    ["Name", "Status"],
  );
  assert.deepEqual(
    blocks[2]?.type === "table" ? blocks[2].rows : [],
    [
      ["Coder", "`ready`"],
      ["Designer", "reviewing"],
    ],
  );
  assert.equal(blocks[3]?.type, "code");
});

test("parseChatMarkdown keeps unsafe links as plain text", () => {
  const blocks = parseChatMarkdown("[bad](javascript:alert(1)) and [ok](https://example.com)");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "paragraph");
});

test("parseChatMarkdown caps oversized tables and content", () => {
  const headers = Array.from({ length: 80 }, (_, index) => `H${index + 1}`).join(" | ");
  const separator = Array.from({ length: 80 }, () => "---").join(" | ");
  const row = Array.from({ length: 80 }, (_, index) => `C${index + 1}`).join(" | ");
  const blocks = parseChatMarkdown(
    [
      `| ${headers} |`,
      `| ${separator} |`,
      ...Array.from({ length: 500 }, () => `| ${row} |`),
    ].join("\n"),
  );

  const table = blocks.find((block) => block.type === "table");
  assert.ok(table);
  assert.equal(table.type === "table" ? table.headers.length : 0, 24);
  assert.equal(table.type === "table" ? table.rows.length : 0, 200);
});

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

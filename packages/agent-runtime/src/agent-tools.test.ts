import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntimeLangChainTools } from "./agent-tools.ts";

function createTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "teamaligned-agent-tools-"));
}

test("workspace_write_text_file creates missing parent directories", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      activeSkill: null,
    });
    const writeTool = tools.find((tool) => tool.name === "workspace_write_text_file");
    assert.ok(writeTool);

    const output = await writeTool.invoke({
      path: "notes/nested/hello.md",
      content: "hello TeamAligned",
    });

    const targetPath = join(workspacePath, "notes", "nested", "hello.md");
    assert.match(String(output), /已写入文件/);
    assert.equal(existsSync(targetPath), true);
    assert.equal(readFileSync(targetPath, "utf8"), "hello TeamAligned");
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace_write_text_file rejects paths outside the workspace", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      activeSkill: null,
    });
    const writeTool = tools.find((tool) => tool.name === "workspace_write_text_file");
    assert.ok(writeTool);

    await assert.rejects(
      () =>
        writeTool.invoke({
          path: "../outside.md",
          content: "nope",
        }),
      /访问路径超出允许范围/,
    );
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

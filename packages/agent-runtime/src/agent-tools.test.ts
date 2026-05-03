import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRuntimeLangChainTools,
  normalizeRuntimeToolErrorMessage,
  ToolExecutionApprovalRequiredError,
} from "./agent-tools.ts";
import { shouldRequireToolApproval } from "./runtime.ts";

function createTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "teamaligned-agent-tools-"));
}

test("workspace_write_text_file creates missing parent directories", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      provider: null,
      responseLanguage: "zh",
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
      provider: null,
      responseLanguage: "zh",
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

test("workspace tools honor the generic execution policy before running", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      provider: null,
      responseLanguage: "zh",
      activeSkill: null,
      approvalPolicy: (request) =>
        request.operation === "write"
          ? { allow: false, reason: "needs user confirmation", requiresConfirmation: true }
          : { allow: true },
    });
    const writeTool = tools.find((tool) => tool.name === "workspace_write_text_file");
    assert.ok(writeTool);

    await assert.rejects(
      () =>
        writeTool.invoke({
          path: "blocked.md",
          content: "should not be written",
        }),
      ToolExecutionApprovalRequiredError,
    );

    assert.equal(existsSync(join(workspacePath, "blocked.md")), false);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("tool approval policy does not interrupt low-risk skill bundle reads", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "skill-stock",
      serverName: "Stock Skill",
      toolName: "read_skill_bundle",
      operation: "skill",
      riskLevel: "low",
      args: { relativePath: "references/data-verification-protocol.md" },
      description: "Read bundled files from the active skill.",
    }),
    false,
  );
});

test("tool approval policy does not interrupt read operations", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "local-workspace",
      serverName: "Workspace",
      toolName: "read_text_file",
      operation: "read",
      riskLevel: "high",
      args: { path: "notes.md" },
      description: "Read a text file from the current workspace.",
    }),
    false,
  );
});

test("tool approval policy still protects executable skill scripts", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "skill-stock",
      serverName: "Stock Skill",
      toolName: "skill_stock_analyze",
      operation: "skill",
      riskLevel: "medium",
      args: { argumentsLine: "--ticker BABA" },
      description: "Run bundled script from the active skill.",
    }),
    true,
  );
});

test("runtime tool error normalization explains path failures with recovery guidance", () => {
  const message = normalizeRuntimeToolErrorMessage({
    toolName: "workspace_read_text_file",
    serverName: "Workspace",
    error: "文件不存在：docs/missing.md",
    responseLanguage: "zh",
  });

  assert.match(message, /找不到目标文件或目录/);
  assert.match(message, /# 选择文件/);
  assert.match(message, /原始错误/);
});

test("runtime tool error normalization explains network failures in English", () => {
  const message = normalizeRuntimeToolErrorMessage({
    toolName: "web_fetch",
    serverName: "Web Fetch",
    error: "fetch failed: ENOTFOUND example.invalid",
    responseLanguage: "en",
  });

  assert.match(message, /network request/i);
  assert.match(message, /retry/i);
  assert.match(message, /Original error/);
});

test("runtime tool error normalization explains command failures with next steps", () => {
  const message = normalizeRuntimeToolErrorMessage({
    toolName: "workspace_run_command",
    serverName: "Workspace Shell",
    error: "zsh: command not found: pnmp",
    responseLanguage: "zh",
  });

  assert.match(message, /命令不可用/);
  assert.match(message, /package scripts|PATH/);
});

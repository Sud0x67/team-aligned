import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillCatalogRecord } from "@teamaligned/shared";
import {
  buildRuntimeLangChainTools,
  normalizeRuntimeToolErrorMessage,
  ToolExecutionApprovalRequiredError,
  type RuntimeToolInvocationEvent,
} from "./agent-tools.ts";
import { shouldRequireToolApproval } from "./runtime.ts";

function createTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "teamaligned-agent-tools-"));
}

function createSkillRecord(input: Partial<SkillCatalogRecord> & Pick<SkillCatalogRecord, "id" | "slug" | "installPath">): SkillCatalogRecord {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name ?? input.slug,
    displayName: input.displayName ?? input.name ?? input.slug,
    description: input.description ?? "A test skill.",
    version: input.version ?? "0.1.0",
    sourceRepo: input.sourceRepo ?? "local",
    sourceBranch: input.sourceBranch ?? "main",
    sourcePath: input.sourcePath ?? input.slug,
    entryFile: input.entryFile ?? "SKILL.md",
    installed: input.installed ?? true,
    installedVersion: input.installedVersion ?? "0.1.0",
    installPath: input.installPath,
    author: input.author ?? "TeamAligned",
    recommendedTools: input.recommendedTools ?? [],
    metadata: input.metadata ?? null,
  };
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

test("workspace command tool requires approval before executing simple commands", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const markerPath = join(workspacePath, "command-ran.txt");
    const requests: string[] = [];
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      provider: null,
      responseLanguage: "zh",
      activeSkill: null,
      approvalPolicy: (request) => {
        requests.push(`${request.toolName}:${request.operation}`);
        return request.operation === "command"
          ? { allow: false, reason: "needs user confirmation", requiresConfirmation: true }
          : { allow: true };
      },
    });
    const commandTool = tools.find((tool) => tool.name === "workspace_run_command");
    assert.ok(commandTool);

    await assert.rejects(
      () =>
        commandTool.invoke({
          command: `touch "${markerPath}"`,
        }),
      ToolExecutionApprovalRequiredError,
    );

    assert.deepEqual(requests, ["run_workspace_command:command"]);
    assert.equal(existsSync(markerPath), false);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace tools return an explicit denied result to the model when user denies execution", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const invocations: RuntimeToolInvocationEvent[] = [];
    const { tools } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      provider: null,
      responseLanguage: "zh",
      activeSkill: null,
      onInvocation: (event) => {
        invocations.push(event);
      },
      approvalPolicy: (request) =>
        request.operation === "write"
          ? { allow: false, reason: "用户拒绝了这次工具执行。" }
          : { allow: true },
    });
    const writeTool = tools.find((tool) => tool.name === "workspace_write_text_file");
    assert.ok(writeTool);

    const output = await writeTool.invoke({
      path: "blocked.md",
      content: "should not be written",
    });
    const outputText = String(output);

    assert.match(outputText, /TOOL_EXECUTION_DENIED/);
    assert.match(outputText, /用户拒绝了这次工具执行/);
    assert.match(outputText, /do not re-request the same permission/i);
    assert.equal(existsSync(join(workspacePath, "blocked.md")), false);
    assert.equal(invocations.some((event) => event.phase === "error"), true);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("tool approval policy does not interrupt low-risk skill bundle reads", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "skill-stock",
      serverName: "Stock Skill",
      toolName: "skill_read_file",
      operation: "skill",
      riskLevel: "low",
      args: { relativePath: "references/data-verification-protocol.md" },
      description: "Read bundled files from an allowlisted skill.",
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

test("tool approval policy does not interrupt workspace-scoped writes", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "local-workspace",
      serverName: "Workspace",
      toolName: "write_text_file",
      operation: "write",
      riskLevel: "high",
      args: { path: "notes.md" },
      description: "Write a text file inside the current workspace.",
      workspaceScoped: true,
    }),
    false,
  );
});

test("tool approval policy still protects non-workspace writes and commands", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "external-files",
      serverName: "External Files",
      toolName: "write_text_file",
      operation: "write",
      riskLevel: "high",
      args: { path: "/tmp/outside.md" },
      description: "Write a file outside the current workspace.",
    }),
    true,
  );
  assert.equal(
    shouldRequireToolApproval({
      serverId: "local-shell",
      serverName: "Workspace Shell",
      toolName: "run_workspace_command",
      operation: "command",
      riskLevel: "high",
      args: { command: "npm test" },
      description: "Run a shell command in the current workspace.",
      workspaceScoped: true,
    }),
    true,
  );
});

test("tool approval policy still protects executable skill scripts", () => {
  assert.equal(
    shouldRequireToolApproval({
      serverId: "skill-stock",
      serverName: "Stock Skill",
      toolName: "skill_run_script",
      operation: "skill",
      riskLevel: "medium",
      args: { argumentsLine: "--ticker BABA" },
      description: "Run bundled script from the active skill.",
    }),
    true,
  );
});

test("runtime exposes allowlisted skills for on-demand loading", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const skillRoot = join(workspacePath, "skills", "code-review");
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(
      join(skillRoot, "SKILL.md"),
      "---\nname: Code Review\ndescription: Review code carefully.\n---\nUse this skill for code review tasks.",
      "utf8",
    );
    writeFileSync(join(skillRoot, "references", "checklist.md"), "Check correctness first.", "utf8");

    const skill = createSkillRecord({
      id: "skill-code-review",
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code carefully.",
      installPath: skillRoot,
    });

    const { tools, summary } = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: [],
      provider: null,
      responseLanguage: "en",
      activeSkill: null,
      availableSkills: [skill],
    });

    assert.match(summary, /Allowlisted Skills/);
    assert.match(summary, /\/code-review/);

    const loadTool = tools.find((tool) => tool.name === "skill_load");
    assert.ok(loadTool);
    const loaded = String(await loadTool.invoke({ skillId: "code-review" }));
    assert.match(loaded, /Use this skill for code review tasks/);

    const readTool = tools.find((tool) => tool.name === "skill_read_file");
    assert.ok(readTool);
    const reference = await readTool.invoke({
      skillId: "skill-code-review",
      relativePath: "references/checklist.md",
    });
    assert.equal(reference, "Check correctness first.");
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
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

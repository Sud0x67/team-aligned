import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractWorkspaceReferenceTokens,
  previewWorkspaceReferences,
  resolveWorkspaceReferences,
  searchWorkspaceFiles,
} from "./workspace-file-search.ts";

function createWorkspace() {
  return mkdtempSync(join(tmpdir(), "teamaligned-workspace-search-"));
}

test("searchWorkspaceFiles supports fuzzy matching and skips internal workspace folders", () => {
  const workspacePath = createWorkspace();
  try {
    mkdirSync(join(workspacePath, "src", "chat"), { recursive: true });
    mkdirSync(join(workspacePath, "docs"), { recursive: true });
    mkdirSync(join(workspacePath, ".teamaligned"), { recursive: true });
    writeFileSync(join(workspacePath, "src", "chat", "composer.tsx"), "composer", "utf8");
    writeFileSync(join(workspacePath, "docs", "chat-reference.md"), "chat", "utf8");
    writeFileSync(join(workspacePath, ".teamaligned", "internal.md"), "ignore", "utf8");

    const results = searchWorkspaceFiles({
      workspacePath,
      query: "chat",
      limit: 10,
    });

    assert.ok(results.length >= 2);
    assert.equal(results.some((item) => item.path === "docs/chat-reference.md"), true);
    assert.equal(results.some((item) => item.path === "src/chat/composer.tsx"), true);
    assert.equal(
      results.some((item) => item.path.includes(".teamaligned")),
      false,
    );
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("extractWorkspaceReferenceTokens parses #path and #[path with spaces]", () => {
  const tokens = extractWorkspaceReferenceTokens(
    "请看 #README.md、#[docs/spec file.md] 和 #README.md 还有 #src/index.ts。",
  );
  assert.deepEqual(tokens, ["README.md", "docs/spec file.md", "src/index.ts"]);
});

test("resolveWorkspaceReferences resolves readable files and reports unresolved tokens", () => {
  const workspacePath = createWorkspace();
  try {
    mkdirSync(join(workspacePath, "docs"), { recursive: true });
    writeFileSync(join(workspacePath, "README.md"), "hello", "utf8");
    writeFileSync(join(workspacePath, "docs", "spec file.md"), "details", "utf8");
    writeFileSync(join(workspacePath, "docs", "long.md"), "a".repeat(16_000), "utf8");

    const result = resolveWorkspaceReferences({
      workspacePath,
      content: "请看 #README.md #[docs/spec file.md] #docs/long.md #missing.md #../outside.md",
    });

    assert.deepEqual(
      result.resolved.map((item) => item.path),
      ["README.md", "docs/spec file.md", "docs/long.md"],
    );
    assert.equal(result.resolved.at(-1)?.truncated, true);
    assert.deepEqual(result.unresolved, ["missing.md", "../outside.md"]);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("resolveWorkspaceReferences treats TeamAligned system directories as unresolved", () => {
  const workspacePath = createWorkspace();
  try {
    mkdirSync(join(workspacePath, ".teamaligned"), { recursive: true });
    writeFileSync(join(workspacePath, "README.md"), "hello", "utf8");
    writeFileSync(join(workspacePath, ".teamaligned", "settings.json"), "{}", "utf8");

    const result = resolveWorkspaceReferences({
      workspacePath,
      content: "请看 #README.md #.teamaligned/settings.json",
    });

    assert.deepEqual(
      result.resolved.map((item) => item.path),
      ["README.md"],
    );
    assert.deepEqual(result.unresolved, [".teamaligned/settings.json"]);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("previewWorkspaceReferences returns per-token status for resolved and unresolved references", () => {
  const workspacePath = createWorkspace();
  try {
    mkdirSync(join(workspacePath, "docs"), { recursive: true });
    mkdirSync(join(workspacePath, ".teamaligned", "memory"), { recursive: true });
    writeFileSync(join(workspacePath, "README.md"), "hello", "utf8");
    writeFileSync(join(workspacePath, ".teamaligned", "memory", "MEMORY.md"), "memory", "utf8");

    const preview = previewWorkspaceReferences({
      workspacePath,
      content: "check #README.md #missing.md #../outside.md #.teamaligned/memory/MEMORY.md #docs",
    });

    assert.deepEqual(preview, [
      {
        token: "README.md",
        path: "README.md",
        absolutePath: join(workspacePath, "README.md"),
        status: "resolved",
      },
      {
        token: "missing.md",
        path: null,
        absolutePath: null,
        status: "missing",
      },
      {
        token: "../outside.md",
        path: null,
        absolutePath: null,
        status: "outside",
      },
      {
        token: ".teamaligned/memory/MEMORY.md",
        path: null,
        absolutePath: null,
        status: "reserved",
      },
      {
        token: "docs",
        path: null,
        absolutePath: null,
        status: "not_file",
      },
    ]);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

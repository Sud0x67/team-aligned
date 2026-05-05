import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkspaceFilesystemBackend,
  normalizeDeepAgentWorkspacePath,
} from "./deep-agent-filesystem.ts";

function createTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "teamaligned-deep-agent-fs-"));
}

test("normalizeDeepAgentWorkspacePath converts workspace absolute paths to virtual paths", () => {
  const workspacePath = createTempWorkspace();
  try {
    assert.equal(
      normalizeDeepAgentWorkspacePath(join(workspacePath, "docs", "spec.md"), workspacePath),
      "/docs/spec.md",
    );
    assert.equal(normalizeDeepAgentWorkspacePath(workspacePath, workspacePath), "/");
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("normalizeDeepAgentWorkspacePath collapses duplicated workspace roots", () => {
  const workspacePath = createTempWorkspace();
  try {
    const workspaceWithoutLeadingSlash = workspacePath.replace(/^[\\/]+/, "");
    assert.equal(
      normalizeDeepAgentWorkspacePath(
        join(workspacePath, workspaceWithoutLeadingSlash, "docs", "spec.md"),
        workspacePath,
      ),
      "/docs/spec.md",
    );
    assert.equal(
      normalizeDeepAgentWorkspacePath(join(workspaceWithoutLeadingSlash, "docs", "spec.md"), workspacePath),
      "/docs/spec.md",
    );
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("normalizeDeepAgentWorkspacePath preserves virtual workspace paths", () => {
  const workspacePath = createTempWorkspace();
  try {
    assert.equal(normalizeDeepAgentWorkspacePath("/docs/spec.md", workspacePath), "/docs/spec.md");
    assert.equal(normalizeDeepAgentWorkspacePath("docs/spec.md", workspacePath), "docs/spec.md");
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("normalizeDeepAgentWorkspacePath rejects host absolute paths outside the workspace", () => {
  const workspacePath = createTempWorkspace();
  try {
    assert.throws(
      () => normalizeDeepAgentWorkspacePath("/Users/someone/other-workspace/file.md", workspacePath),
      /outside the workspace sandbox/,
    );
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace filesystem backend writes workspace absolute paths without duplicating the root", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const backend = createWorkspaceFilesystemBackend(workspacePath);
    const targetPath = join(workspacePath, "hello.md");

    const result = await backend.write(targetPath, "hello TeamAligned");

    assert.equal(result.error, undefined);
    assert.equal(existsSync(targetPath), true);
    assert.equal(readFileSync(targetPath, "utf8"), "hello TeamAligned");
    assert.equal(existsSync(join(workspacePath, workspacePath.replace(/^[\\/]+/, ""))), false);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace filesystem backend returns recoverable guidance when write target exists", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const backend = createWorkspaceFilesystemBackend(workspacePath);
    const targetPath = join(workspacePath, "aws-health-iot-architecture.drawio");

    await backend.write(targetPath, "first");
    const result = await backend.write(targetPath, "second");

    assert.match(result.error ?? "", /already exists/);
    assert.match(result.error ?? "", /Do not stop/);
    assert.match(result.error ?? "", /aws-health-iot-architecture-2\.drawio/);
    assert.equal(readFileSync(targetPath, "utf8"), "first");
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace filesystem backend collapses duplicated absolute workspace prefixes", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const backend = createWorkspaceFilesystemBackend(workspacePath);
    const workspaceWithoutLeadingSlash = workspacePath.replace(/^[\\/]+/, "");
    const duplicatedPath = join(workspacePath, workspaceWithoutLeadingSlash, "hello.md");
    const targetPath = join(workspacePath, "hello.md");

    const result = await backend.write(duplicatedPath, "hello TeamAligned");

    assert.equal(result.error, undefined);
    assert.equal(existsSync(targetPath), true);
    assert.equal(readFileSync(targetPath, "utf8"), "hello TeamAligned");
    assert.equal(existsSync(duplicatedPath), false);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("workspace filesystem backend rejects host absolute writes outside the workspace", async () => {
  const workspacePath = createTempWorkspace();
  try {
    const backend = createWorkspaceFilesystemBackend(workspacePath);
    const result = await backend.write("/Users/someone/other-workspace/file.md", "nope");

    assert.match(result.error ?? "", /outside the workspace sandbox/);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

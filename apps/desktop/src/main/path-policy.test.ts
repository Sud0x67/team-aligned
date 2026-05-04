import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { isPathInside, resolveAllowedWorkspaceOpenPath } from "./path-policy.ts";

test("isPathInside accepts the root itself and nested paths", () => {
  const root = "/Users/alex/.teamaligned";

  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, "/Users/alex/.teamaligned/workspaces/agent-a"), true);
});

test("isPathInside rejects sibling paths that only share a prefix", () => {
  assert.equal(isPathInside("/Users/alex/.teamaligned", "/Users/alex/.teamaligned-evil"), false);
});

test("resolveAllowedWorkspaceOpenPath allows existing paths under known roots", () => {
  const root = "/Users/alex/.teamaligned";
  const result = resolveAllowedWorkspaceOpenPath(
    "/Users/alex/.teamaligned/workspaces/agent-a",
    [root],
    () => true,
  );

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, resolve("/Users/alex/.teamaligned/workspaces/agent-a"));
});

test("resolveAllowedWorkspaceOpenPath rejects outside and missing paths", () => {
  const root = "/Users/alex/.teamaligned";
  const outside = resolveAllowedWorkspaceOpenPath("/Users/alex/.ssh", [root], () => true);
  const missing = resolveAllowedWorkspaceOpenPath("/Users/alex/.teamaligned/missing", [root], () => false);

  assert.equal(outside.ok, false);
  assert.equal(outside.reason, "outside_allowed_roots");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_path");
});

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function isPathInside(parentPath: string, childPath: string) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function resolveAllowedWorkspaceOpenPath(
  workspacePath: unknown,
  allowedRoots: string[],
  pathExists: (path: string) => boolean = existsSync,
) {
  const resolvedPath = resolve(String(workspacePath ?? ""));
  const allowed = allowedRoots.some((root) => isPathInside(root, resolvedPath));
  if (!allowed) {
    return {
      ok: false as const,
      resolvedPath,
      reason: "outside_allowed_roots",
    };
  }

  if (!pathExists(resolvedPath)) {
    return {
      ok: false as const,
      resolvedPath,
      reason: "missing_path",
    };
  }

  return {
    ok: true as const,
    resolvedPath,
  };
}

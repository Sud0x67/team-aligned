import { isAbsolute, relative, resolve } from "node:path";

export const reservedWorkspaceDirNames = [".teamaligned"] as const;

export function formatReservedWorkspaceDirList() {
  return reservedWorkspaceDirNames.join(" / ");
}

function splitPortablePath(pathValue: string) {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
}

export function normalizeVirtualWorkspacePath(pathValue: string) {
  const parts = splitPortablePath(pathValue);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function isReservedVirtualWorkspacePath(pathValue: string) {
  const [firstSegment] = splitPortablePath(pathValue);
  return reservedWorkspaceDirNames.includes(firstSegment as (typeof reservedWorkspaceDirNames)[number]);
}

export function isReservedWorkspacePath(pathValue: string, workspaceRoot: string) {
  const root = resolve(workspaceRoot);
  const target = resolve(pathValue);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }
  return isReservedVirtualWorkspacePath(relativePath);
}

export function createReservedWorkspacePathError(language: "zh" | "en" = "zh") {
  const dirs = formatReservedWorkspaceDirList();
  return language === "en"
    ? `TeamAligned system directory is reserved. Do not read, search, write, or edit files under ${dirs}; use a normal workspace path instead.`
    : `TeamAligned 系统保留目录不可由 Agent 读取、搜索、写入或编辑（${dirs}）。请改用普通 workspace 路径。`;
}

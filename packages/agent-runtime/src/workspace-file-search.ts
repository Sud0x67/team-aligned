import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const ignoredDirNames = new Set([
  ".git",
  ".team-aligned",
  "node_modules",
]);
const maxScannedFiles = 6000;
const defaultSearchLimit = 20;
const maxSearchLimit = 50;

const maxReferencedFiles = 5;
const maxReferencedCharsPerFile = 12_000;

export type WorkspaceFileSuggestion = {
  path: string;
  absolutePath: string;
  score: number;
};

export type WorkspaceFileReference = {
  token: string;
  path: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
};

export type WorkspaceReferencePreview = {
  token: string;
  path: string | null;
  absolutePath: string | null;
  status: "resolved" | "missing" | "outside" | "not_file" | "unreadable";
};

function normalizeSeparators(pathValue: string) {
  return pathValue.replaceAll("\\", "/");
}

function isPathInside(parentPath: string, childPath: string) {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function safeReadDirectory(dirPath: string) {
  try {
    return readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listWorkspaceFiles(workspacePath: string) {
  const workspaceRoot = resolve(workspacePath);
  const pendingDirs = [workspaceRoot];
  const files: string[] = [];

  while (pendingDirs.length > 0 && files.length < maxScannedFiles) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) break;

    const entries = safeReadDirectory(currentDir).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      if (files.length >= maxScannedFiles) break;
      if (entry.name === "." || entry.name === "..") continue;

      const absolutePath = resolve(currentDir, entry.name);
      if (!isPathInside(workspaceRoot, absolutePath)) continue;

      if (entry.isDirectory()) {
        if (ignoredDirNames.has(entry.name)) continue;
        pendingDirs.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      files.push(absolutePath);
    }
  }

  return files;
}

function computeSubsequenceScore(haystack: string, needle: string) {
  let cursor = 0;
  let gap = 0;

  for (const char of needle) {
    const next = haystack.indexOf(char, cursor);
    if (next < 0) return null;
    gap += next - cursor;
    cursor = next + 1;
  }

  return Math.max(1, 320 - gap);
}

function computeFuzzyScore(relativePath: string, query: string) {
  const normalizedPath = normalizeSeparators(relativePath).toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const fileName = basename(normalizedPath);

  if (!normalizedQuery) return 1000;
  if (fileName === normalizedQuery) return 2300;
  if (fileName.startsWith(normalizedQuery)) {
    return 2100 - Math.max(0, fileName.length - normalizedQuery.length);
  }

  const fileNamePosition = fileName.indexOf(normalizedQuery);
  if (fileNamePosition >= 0) return 1700 - fileNamePosition;

  if (normalizedPath.startsWith(normalizedQuery)) {
    return 1400 - Math.max(0, normalizedPath.length - normalizedQuery.length);
  }

  const pathPosition = normalizedPath.indexOf(normalizedQuery);
  if (pathPosition >= 0) return 1100 - pathPosition;

  const fileNameSubsequence = computeSubsequenceScore(fileName, normalizedQuery);
  if (fileNameSubsequence !== null) return 700 + fileNameSubsequence;

  const pathSubsequence = computeSubsequenceScore(normalizedPath, normalizedQuery);
  if (pathSubsequence !== null) return 300 + pathSubsequence;

  return null;
}

function normalizeReferenceToken(token: string) {
  return token
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[、，。,.;:!?！？；：]+$/g, "");
}

function readTextReferenceFile(absolutePath: string) {
  const buffer = readFileSync(absolutePath);
  const binaryChunk = buffer.subarray(0, 2048);
  if (binaryChunk.includes(0)) {
    throw new Error("binary");
  }
  const text = buffer.toString("utf8");
  if (text.length <= maxReferencedCharsPerFile) {
    return { content: text, truncated: false };
  }
  return {
    content: `${text.slice(0, maxReferencedCharsPerFile)}\n...`,
    truncated: true,
  };
}

export function searchWorkspaceFiles(input: {
  workspacePath: string;
  query: string;
  limit?: number;
}): WorkspaceFileSuggestion[] {
  const workspaceRoot = resolve(input.workspacePath);
  if (!existsSync(workspaceRoot)) return [];

  const stats = statSync(workspaceRoot);
  if (!stats.isDirectory()) return [];

  const query = input.query.trim();
  const limit = Math.max(1, Math.min(maxSearchLimit, input.limit ?? defaultSearchLimit));
  const candidates = listWorkspaceFiles(workspaceRoot)
    .map((absolutePath) => {
      const relativePath = normalizeSeparators(relative(workspaceRoot, absolutePath));
      const score = computeFuzzyScore(relativePath, query);
      if (score === null) return null;
      return {
        path: relativePath,
        absolutePath,
        score,
      };
    })
    .filter((item): item is WorkspaceFileSuggestion => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.path.length !== right.path.length) return left.path.length - right.path.length;
      return left.path.localeCompare(right.path);
    });

  return candidates.slice(0, limit);
}

export function extractWorkspaceReferenceTokens(input: string) {
  const tokens = new Set<string>();
  const pattern =
    /(?:^|[\s([{（【,，。、.!?！？;；:：])#(?:\[([^\]\n]+)\]|([^\s#，。,、!?！？;；:：\]】)]+))/g;

  for (const match of input.matchAll(pattern)) {
    const value = normalizeReferenceToken(match[1] ?? match[2] ?? "");
    if (value) {
      tokens.add(value);
    }
  }

  return Array.from(tokens).slice(0, maxReferencedFiles);
}

export function resolveWorkspaceReferences(input: {
  workspacePath: string;
  content: string;
}) {
  const previews = previewWorkspaceReferences(input);
  const resolved: WorkspaceFileReference[] = [];
  const unresolved: string[] = previews
    .filter((preview) => preview.status !== "resolved")
    .map((preview) => preview.token);

  for (const preview of previews) {
    if (preview.status !== "resolved" || !preview.absolutePath || !preview.path) {
      continue;
    }

    try {
      const loaded = readTextReferenceFile(preview.absolutePath);
      resolved.push({
        token: preview.token,
        path: preview.path,
        absolutePath: preview.absolutePath,
        content: loaded.content,
        truncated: loaded.truncated,
      });
    } catch {
      unresolved.push(preview.token);
    }
  }

  return { resolved, unresolved };
}

export function previewWorkspaceReferences(input: {
  workspacePath: string;
  content: string;
}): WorkspaceReferencePreview[] {
  const workspaceRoot = resolve(input.workspacePath);
  const tokens = extractWorkspaceReferenceTokens(input.content);
  const previews: WorkspaceReferencePreview[] = [];

  for (const token of tokens) {
    const candidatePath = token.startsWith("/")
      ? resolve(token)
      : resolve(workspaceRoot, token);

    if (!isPathInside(workspaceRoot, candidatePath)) {
      previews.push({
        token,
        path: null,
        absolutePath: null,
        status: "outside",
      });
      continue;
    }

    if (!existsSync(candidatePath)) {
      previews.push({
        token,
        path: null,
        absolutePath: null,
        status: "missing",
      });
      continue;
    }

    let stats;
    try {
      stats = statSync(candidatePath);
    } catch {
      previews.push({
        token,
        path: null,
        absolutePath: null,
        status: "unreadable",
      });
      continue;
    }

    if (!stats.isFile()) {
      previews.push({
        token,
        path: null,
        absolutePath: null,
        status: "not_file",
      });
      continue;
    }

    previews.push({
      token,
      path: normalizeSeparators(relative(workspaceRoot, candidatePath)),
      absolutePath: candidatePath,
      status: "resolved",
    });
  }

  return previews;
}

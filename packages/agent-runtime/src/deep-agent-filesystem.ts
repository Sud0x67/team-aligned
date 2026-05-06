import {
  FilesystemBackend,
  type BackendProtocol,
  type EditResult,
  type FileData,
  type FileDownloadResponse,
  type FileInfo,
  type FileUploadResponse,
  type GrepMatch,
  type WriteResult,
} from "deepagents";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import {
  createReservedWorkspacePathError,
  isReservedVirtualWorkspacePath,
  normalizeVirtualWorkspacePath,
} from "./workspace-reserved-paths.ts";

const HOST_ABSOLUTE_ROOTS = [
  "/Users",
  "/home",
  "/private",
  "/tmp",
  "/var",
  "/Applications",
  "/Library",
  "/System",
  "/bin",
  "/etc",
  "/opt",
  "/sbin",
  "/usr",
  "/Volumes",
];

function toPortablePath(value: string) {
  return value.split(sep).join("/");
}

function isInsidePath(candidate: string, root: string) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function looksLikeHostAbsolutePath(value: string) {
  const portable = value.replace(/\\/g, "/");
  return HOST_ABSOLUTE_ROOTS.some((root) => portable === root || portable.startsWith(`${root}/`));
}

function pathError(filePath: string, workspaceRoot: string) {
  return `Host absolute path is outside the workspace sandbox. Use a workspace-relative path instead. path=${filePath}, workspace=${workspaceRoot}`;
}

function suggestNonConflictingPath(filePath: string) {
  const portablePath = filePath.replace(/\\/g, "/");
  const directory = posix.dirname(portablePath);
  const extension = posix.extname(portablePath);
  const basename = posix.basename(portablePath, extension);
  const suggestedName = `${basename || "untitled"}-2${extension}`;
  return directory === "." || directory === "/" ? `/${suggestedName}` : `${directory}/${suggestedName}`;
}

function normalizeWriteError(filePath: string, error: string) {
  if (/TeamAligned system directory is reserved/i.test(error)) return error;
  if (!/already exists/i.test(error)) return error;
  const suggestedPath = suggestNonConflictingPath(filePath);
  return [
    error,
    `This is recoverable. Do not stop after this tool result.`,
    `If the user did not explicitly ask to overwrite the existing file, call write_file again with a new path such as ${suggestedPath}.`,
    "If overwrite is intended, read_file first and then use edit_file.",
  ].join(" ");
}

function stripDuplicatedWorkspaceRoot(filePath: string, workspaceRoot: string) {
  const portablePath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const portableRoot = toPortablePath(workspaceRoot).replace(/^\/+/, "");
  if (!portableRoot) return null;
  if (portablePath === portableRoot) return "/";
  if (!portablePath.startsWith(`${portableRoot}/`)) return null;
  return `/${portablePath.slice(portableRoot.length + 1)}`;
}

export function normalizeDeepAgentWorkspacePath(filePath: string, workspaceRoot: string) {
  const trimmed = filePath.trim();
  if (!trimmed) return filePath;

  const root = resolve(workspaceRoot);
  if (isAbsolute(trimmed)) {
    const resolvedInput = resolve(trimmed);
    if (isInsidePath(resolvedInput, root)) {
      const relativePath = relative(root, resolvedInput);
      if (!relativePath) return "/";
      const deduplicatedPath = stripDuplicatedWorkspaceRoot(toPortablePath(relativePath), root);
      return deduplicatedPath ?? `/${toPortablePath(relativePath)}`;
    }

    const deduplicatedPath = stripDuplicatedWorkspaceRoot(trimmed, root);
    if (deduplicatedPath) return deduplicatedPath;

    if (looksLikeHostAbsolutePath(trimmed)) {
      throw new Error(pathError(filePath, workspaceRoot));
    }
  }

  const deduplicatedPath = stripDuplicatedWorkspaceRoot(trimmed, root);
  if (deduplicatedPath) return deduplicatedPath;

  return filePath;
}

export const deepAgentMemoryFilePath = "/.teamaligned/memory/MEMORY.md";

type WorkspaceFilesystemOperation = "read" | "write" | "list" | "search" | "upload" | "download";

type WorkspaceFilesystemBackendOptions = {
  reservedReadAllowlist?: string[];
};

class WorkspaceFilesystemBackend implements BackendProtocol {
  private readonly backend: FilesystemBackend;
  private readonly workspaceRoot: string;
  private readonly reservedReadAllowlist: Set<string>;

  constructor(workspaceRoot: string, options: WorkspaceFilesystemBackendOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.reservedReadAllowlist = new Set(
      (options.reservedReadAllowlist ?? []).map((pathValue) =>
        normalizeVirtualWorkspacePath(pathValue),
      ),
    );
    this.backend = new FilesystemBackend({
      rootDir: workspaceRoot,
      virtualMode: true,
    });
  }

  private normalize(filePath: string, operation: WorkspaceFilesystemOperation) {
    const normalizedPath = normalizeDeepAgentWorkspacePath(filePath, this.workspaceRoot);
    this.assertSystemPathAllowed(normalizedPath, operation);
    return normalizedPath;
  }

  private assertSystemPathAllowed(filePath: string, operation: WorkspaceFilesystemOperation) {
    if (!isReservedVirtualWorkspacePath(filePath)) return;
    if (
      operation === "read" &&
      this.reservedReadAllowlist.has(normalizeVirtualWorkspacePath(filePath))
    ) {
      return;
    }
    throw new Error(createReservedWorkspacePathError("en"));
  }

  private filterVisibleFileInfo(items: FileInfo[]) {
    return items.filter((item) => !isReservedVirtualWorkspacePath(item.path));
  }

  private filterVisibleGrepMatches(matches: GrepMatch[]) {
    return matches.filter((match) => !isReservedVirtualWorkspacePath(match.path));
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      return this.filterVisibleFileInfo(await this.backend.lsInfo(this.normalize(path, "list")));
    } catch {
      return [];
    }
  }

  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    try {
      return await this.backend.read(this.normalize(filePath, "read"), offset, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error reading file '${filePath}': ${message}`;
    }
  }

  async readRaw(filePath: string): Promise<FileData> {
    return this.backend.readRaw(this.normalize(filePath, "read"));
  }

  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[] | string> {
    try {
      const result = await this.backend.grepRaw(
        pattern,
        path ? this.normalize(path, "search") : undefined,
        glob,
      );
      return Array.isArray(result) ? this.filterVisibleGrepMatches(result) : result;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    try {
      return this.filterVisibleFileInfo(
        await this.backend.globInfo(pattern, path ? this.normalize(path, "search") : path),
      );
    } catch {
      return [];
    }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      const normalizedPath = this.normalize(filePath, "write");
      const result = await this.backend.write(normalizedPath, content);
      if (result.error) {
        return {
          ...result,
          error: normalizeWriteError(normalizedPath, result.error),
        };
      }
      return result;
    } catch (error) {
      return {
        error: normalizeWriteError(filePath, error instanceof Error ? error.message : String(error)),
        filesUpdate: null,
      };
    }
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    try {
      return await this.backend.edit(
        this.normalize(filePath, "write"),
        oldString,
        newString,
        replaceAll,
      );
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        filesUpdate: null,
      };
    }
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const normalizedFiles: Array<[string, Uint8Array]> = [];
    const responses: FileUploadResponse[] = [];

    for (const [filePath, content] of files) {
      try {
        normalizedFiles.push([this.normalize(filePath, "upload"), content]);
      } catch {
        responses.push({ path: filePath, error: "invalid_path" });
      }
    }

    if (normalizedFiles.length === 0) return responses;
    return [...responses, ...(await this.backend.uploadFiles(normalizedFiles))];
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const normalizedPaths: string[] = [];
    const pathByNormalizedPath = new Map<string, string>();
    const responses: FileDownloadResponse[] = [];

    for (const filePath of paths) {
      try {
        const normalized = this.normalize(filePath, "download");
        normalizedPaths.push(normalized);
        pathByNormalizedPath.set(normalized, filePath);
      } catch {
        responses.push({ path: filePath, content: null, error: "invalid_path" });
      }
    }

    if (normalizedPaths.length === 0) return responses;

    const downloads = await this.backend.downloadFiles(normalizedPaths);
    return [
      ...responses,
      ...downloads.map((download) => ({
        ...download,
        path: pathByNormalizedPath.get(download.path) ?? download.path,
      })),
    ];
  }
}

export function createWorkspaceFilesystemBackend(
  workspaceRoot: string,
  options?: WorkspaceFilesystemBackendOptions,
): BackendProtocol {
  return new WorkspaceFilesystemBackend(workspaceRoot, options);
}

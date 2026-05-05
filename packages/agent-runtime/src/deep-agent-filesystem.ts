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

class WorkspaceFilesystemBackend implements BackendProtocol {
  private readonly backend: FilesystemBackend;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.backend = new FilesystemBackend({
      rootDir: workspaceRoot,
      virtualMode: true,
    });
  }

  private normalize(filePath: string) {
    return normalizeDeepAgentWorkspacePath(filePath, this.workspaceRoot);
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      return await this.backend.lsInfo(this.normalize(path));
    } catch {
      return [];
    }
  }

  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    try {
      return await this.backend.read(this.normalize(filePath), offset, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error reading file '${filePath}': ${message}`;
    }
  }

  async readRaw(filePath: string): Promise<FileData> {
    return this.backend.readRaw(this.normalize(filePath));
  }

  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[] | string> {
    try {
      return await this.backend.grepRaw(pattern, path ? this.normalize(path) : undefined, glob);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    try {
      return await this.backend.globInfo(pattern, path ? this.normalize(path) : path);
    } catch {
      return [];
    }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      const normalizedPath = this.normalize(filePath);
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
      return await this.backend.edit(this.normalize(filePath), oldString, newString, replaceAll);
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
        normalizedFiles.push([this.normalize(filePath), content]);
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
        const normalized = this.normalize(filePath);
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

export function createWorkspaceFilesystemBackend(workspaceRoot: string): BackendProtocol {
  return new WorkspaceFilesystemBackend(workspaceRoot);
}

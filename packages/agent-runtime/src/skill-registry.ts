import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  TEAMALIGNED_ASSISTANT_SKILL_DEFINITION,
  isSystemBuiltinSkill,
  type SkillCatalogRecord,
} from "@teamaligned/shared";

type RemoteSkillCatalog = {
  generatedAt?: string;
  count?: number;
  skills: RemoteSkillCatalogEntry[];
};

type RemoteSkillCatalogEntry = {
  id: string;
  slug?: string;
  name: string;
  displayName?: string;
  description: string;
  version: string;
  category?: string;
  tags?: string[];
  author?: string;
  entry?: string;
  recommendedTools?: string[];
  sources?: string[];
  installPath?: string;
};

const DEFAULT_BRANCH = process.env.TEAMALIGNED_SKILL_REGISTRY_BRANCH?.trim() || "main";
const DEFAULT_REPO_URL = "https://github.com/Sud0x67/team-aligned-skills";
const DEFAULT_LOCAL_REGISTRY_CANDIDATES = [
  resolve(process.cwd(), "..", "team-aligned-skills"),
  resolve(process.cwd(), "team-aligned-skills"),
];

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isGitHubRepoUrl(value: string) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(value.replace(/\.git$/i, ""));
}

function ensureTrailingGit(source: string) {
  return source.endsWith(".git") ? source : `${source.replace(/\/+$/g, "")}.git`;
}

function resolveRegistrySource() {
  const configured = process.env.TEAMALIGNED_SKILL_REGISTRY_SOURCE?.trim();
  if (configured) {
    return configured;
  }

  const localMatch = DEFAULT_LOCAL_REGISTRY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (localMatch) {
    return localMatch;
  }

  return DEFAULT_REPO_URL;
}

function toCatalogLocation(source: string, branch: string) {
  if (!isHttpUrl(source)) {
    return join(source, "catalog", "skills.json");
  }

  if (source.endsWith(".json")) {
    return source;
  }

  if (!isGitHubRepoUrl(source)) {
    throw new Error(`当前仅支持 GitHub repo URL 或本地目录作为 Skill registry：${source}`);
  }

  const normalized = source.replace(/\.git$/i, "").replace(/\/+$/g, "");
  const [, owner, repo] = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i) ?? [];
  if (!owner || !repo) {
    throw new Error(`无法解析 GitHub Skill registry 地址：${source}`);
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/catalog/skills.json`;
}

function mapRemoteCatalog(
  catalog: RemoteSkillCatalog,
  sourceRepo: string,
  branch: string,
): SkillCatalogRecord[] {
  return catalog.skills.map((item) => {
    const slug = item.slug || item.installPath?.split("/").at(-1) || item.id;
    return {
      id: item.id,
      slug,
      name: item.name,
      displayName: item.displayName || item.name,
      description: item.description,
      version: item.version,
      sourceRepo,
      sourceBranch: branch,
      sourcePath: item.installPath || `skills/${slug}`,
      entryFile: item.entry || "SKILL.md",
      installed: false,
      installedVersion: null,
      installPath: null,
      author: item.author || "Unknown",
      recommendedTools: item.recommendedTools || [],
      metadata: {
        category: item.category || null,
        tags: item.tags || [],
        sources: item.sources || [],
      },
    };
  });
}

export async function fetchSkillCatalog() {
  const source = resolveRegistrySource();
  const branch = DEFAULT_BRANCH;
  const catalogLocation = toCatalogLocation(source, branch);

  if (!isHttpUrl(catalogLocation)) {
    const content = readFileSync(catalogLocation, "utf8");
    return mapRemoteCatalog(JSON.parse(content) as RemoteSkillCatalog, source, branch);
  }

  const response = await fetch(catalogLocation);
  if (!response.ok) {
    throw new Error(`拉取 Skill catalog 失败：${response.status} ${response.statusText}`);
  }

  return mapRemoteCatalog((await response.json()) as RemoteSkillCatalog, source, branch);
}

export async function installSkillFromRegistry(input: {
  skill: SkillCatalogRecord;
  installRoot: string;
}) {
  const destination = join(input.installRoot, input.skill.id, input.skill.version);
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { recursive: true, force: true });

  if (!isHttpUrl(input.skill.sourceRepo)) {
    const sourcePath = join(input.skill.sourceRepo, input.skill.sourcePath);
    cpSync(sourcePath, destination, { recursive: true });
    return {
      installPath: destination,
      version: input.skill.version,
    };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "teamaligned-skill-"));
  const cloneDir = join(tempRoot, "repo");
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        input.skill.sourceBranch,
        ensureTrailingGit(input.skill.sourceRepo),
        cloneDir,
      ],
      { stdio: "ignore" },
    );

    const sourcePath = join(cloneDir, input.skill.sourcePath);
    cpSync(sourcePath, destination, { recursive: true });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    installPath: destination,
    version: input.skill.version,
  };
}

export function readInstalledSkillDefinition(skill: SkillCatalogRecord) {
  if (isSystemBuiltinSkill(skill)) {
    return TEAMALIGNED_ASSISTANT_SKILL_DEFINITION;
  }

  if (!skill.installPath) {
    return null;
  }

  const entryPath = join(skill.installPath, skill.entryFile);
  if (!existsSync(entryPath)) {
    return null;
  }

  return readFileSync(entryPath, "utf8");
}

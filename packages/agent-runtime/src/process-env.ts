const safeEnvKeyPatterns = [
  /^PATH$/i,
  /^HOME$/i,
  /^USER$/i,
  /^LOGNAME$/i,
  /^SHELL$/i,
  /^TERM$/i,
  /^TMPDIR$/i,
  /^TMP$/i,
  /^TEMP$/i,
  /^LANG$/i,
  /^LC_[A-Z0-9_]+$/i,
  /^SYSTEMROOT$/i,
  /^COMSPEC$/i,
  /^WINDIR$/i,
  /^USERPROFILE$/i,
  /^APPDATA$/i,
  /^LOCALAPPDATA$/i,
];

function parseAllowlist(value: string | undefined) {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isSafeBaseEnvKey(key: string, explicitAllowlist: Set<string>) {
  return explicitAllowlist.has(key) || safeEnvKeyPatterns.some((pattern) => pattern.test(key));
}

export function buildChildProcessEnv(
  overrides: Record<string, unknown> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  const explicitAllowlist = parseAllowlist(baseEnv.TEAMALIGNED_CHILD_ENV_ALLOWLIST);
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string" && isSafeBaseEnvKey(key, explicitAllowlist)) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

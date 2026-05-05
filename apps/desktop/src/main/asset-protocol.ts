import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isPathInside } from "./path-policy.ts";

export type AssetProtocolResolution =
  | {
      ok: true;
      assetPath: string;
    }
  | {
      ok: false;
      status: 400 | 403 | 404;
      reason: "invalid_url" | "invalid_asset_url" | "invalid_asset_path" | "outside_allowed_roots" | "missing_asset";
      assetPath?: string;
    };

export function resolveAssetProtocolRequest(
  requestUrl: string,
  allowedRoots: string[],
  pathExists: (path: string) => boolean = existsSync,
): AssetProtocolResolution {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400, reason: "invalid_url" };
  }

  if (url.protocol !== "teamaligned-asset:" || url.hostname !== "local") {
    return { ok: false, status: 400, reason: "invalid_asset_url" };
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return { ok: false, status: 400, reason: "invalid_asset_path" };
  }

  if (!decodedPath) {
    return { ok: false, status: 400, reason: "invalid_asset_path" };
  }

  const assetPath = resolve(decodedPath);
  const normalizedRoots = allowedRoots.map((root) => resolve(root));
  if (!normalizedRoots.some((root) => isPathInside(root, assetPath))) {
    return {
      ok: false,
      status: 403,
      reason: "outside_allowed_roots",
      assetPath,
    };
  }

  if (!pathExists(assetPath)) {
    return {
      ok: false,
      status: 404,
      reason: "missing_asset",
      assetPath,
    };
  }

  return {
    ok: true,
    assetPath,
  };
}

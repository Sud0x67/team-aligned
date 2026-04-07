export function resolveAssetSrc(src?: string | null) {
  if (!src) return null;
  if (/^(data:|https?:|blob:|file:)/i.test(src)) {
    return src;
  }
  if (src.startsWith("/")) {
    return `teamaligned-asset://local/${encodeURIComponent(src)}`;
  }
  return src;
}

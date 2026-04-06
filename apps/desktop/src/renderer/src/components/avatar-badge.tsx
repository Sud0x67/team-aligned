import type { CSSProperties } from "react";
import { resolveAssetSrc } from "../lib/asset-src";

export function AvatarBadge({
  src,
  fallback,
  alt,
  className,
  style,
  textClassName = "",
}: {
  src?: string | null;
  fallback: string;
  alt: string;
  className: string;
  style?: CSSProperties;
  textClassName?: string;
}) {
  const resolvedSrc = resolveAssetSrc(src);
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${textClassName}`}>
          {fallback}
        </span>
      )}
    </div>
  );
}

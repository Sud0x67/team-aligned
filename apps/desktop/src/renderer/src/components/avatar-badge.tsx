import { useEffect, useState } from "react";
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
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedSrc]);

  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {resolvedSrc && !imageFailed ? (
        <img
          src={resolvedSrc}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${textClassName}`}>
          {fallback}
        </span>
      )}
    </div>
  );
}

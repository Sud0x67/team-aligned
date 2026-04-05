import type { CSSProperties } from "react";

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
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${textClassName}`}>
          {fallback}
        </span>
      )}
    </div>
  );
}

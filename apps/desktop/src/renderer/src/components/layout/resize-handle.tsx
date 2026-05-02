import type { ReactNode } from "react";

type ResizeHandleProps = {
  axis: "x" | "y";
  onResizeStart?: () => void;
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
};

function getHandleClass(axis: "x" | "y") {
  if (axis === "x") {
    return "w-2 cursor-col-resize touch-none px-[2px]";
  }
  return "h-2 cursor-row-resize touch-none py-[2px]";
}

function getGripClass(axis: "x" | "y") {
  if (axis === "x") {
    return "h-full w-full rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] transition hover:bg-[color-mix(in_srgb,var(--primary)_34%,transparent)]";
  }
  return "h-full w-full rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] transition hover:bg-[color-mix(in_srgb,var(--primary)_34%,transparent)]";
}

export function ResizeHandle({
  axis,
  onResizeStart,
  onResize,
  onResizeEnd,
  className,
  ariaLabel,
  children,
}: ResizeHandleProps) {
  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startCoordinate = axis === "x" ? event.clientX : event.clientY;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    onResizeStart?.();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentCoordinate = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      onResize(currentCoordinate - startCoordinate);
    };

    const handleMouseUp = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onResizeEnd?.();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={ariaLabel}
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      className={`${getHandleClass(axis)} ${className ?? ""}`}
    >
      {children ? <>{children}</> : <div className={getGripClass(axis)} />}
    </div>
  );
}

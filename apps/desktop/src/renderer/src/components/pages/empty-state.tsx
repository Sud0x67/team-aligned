import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--card)] p-6 text-center">
      <h3 className="text-lg font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-[var(--muted-foreground)]">
        {description}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

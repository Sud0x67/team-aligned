import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  showHeader = true,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  showHeader?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] px-6 py-6 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-5 pb-6">
        {showHeader ? (
          <header className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-soft">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                teamaligned
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {title}
              </h1>
              {description ? (
                <p className="max-w-3xl text-sm leading-7 text-[var(--muted-foreground)]">{description}</p>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

export function SectionCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)]">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

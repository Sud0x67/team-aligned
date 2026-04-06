export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        {label}
      </p>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">{value}</span>
        {hint ? <span className="pb-1 text-sm text-[var(--muted-foreground)]">{hint}</span> : null}
      </div>
    </div>
  );
}

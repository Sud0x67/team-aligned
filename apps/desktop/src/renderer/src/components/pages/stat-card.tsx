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
    <div className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-semibold tracking-tight text-slate-950">{value}</span>
        {hint ? <span className="pb-1 text-sm text-slate-500">{hint}</span> : null}
      </div>
    </div>
  );
}


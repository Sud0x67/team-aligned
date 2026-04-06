import type { ReactNode } from "react";

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "indigo" | "emerald" | "amber" | "rose" | "cyan";
}) {
  const tones: Record<string, string> = {
    slate: "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
    indigo: "border-indigo-500/20 bg-indigo-500/10 text-indigo-500",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-500",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-500",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-500",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

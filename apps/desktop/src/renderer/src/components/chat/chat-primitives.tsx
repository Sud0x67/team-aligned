import type { ReactNode } from "react";

export function SectionPill({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--primary)] text-white shadow-soft"
          : "border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--panel-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

export function StatChip({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted-text)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

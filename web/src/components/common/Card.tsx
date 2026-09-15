import type { ReactNode } from "react";

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={`rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold text-[var(--text-bright)]">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({ label, value, tone = "neutral", sub }: { label: string; value: ReactNode; tone?: "ok" | "warning" | "danger" | "neutral" | "accent"; sub?: string }) {
  const toneColor: Record<string, string> = {
    ok: "text-[var(--ok)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    neutral: "text-[var(--text-bright)]",
    accent: "text-[var(--accent)]",
  };
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneColor[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-dim)]">{sub}</div>}
    </div>
  );
}

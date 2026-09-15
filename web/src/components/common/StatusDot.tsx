export type StatusTone = "ok" | "warning" | "danger" | "neutral" | "accent";

const toneClass: Record<StatusTone, string> = {
  ok: "bg-[var(--ok)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
  neutral: "bg-[var(--hold)]",
  accent: "bg-[var(--accent)]",
};

export function StatusDot({ tone, pulse = false }: { tone: StatusTone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${toneClass[tone]} ${pulse ? "animate-pulse" : ""}`}
      aria-hidden
    />
  );
}

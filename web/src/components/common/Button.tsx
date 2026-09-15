import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variantClass: Record<Variant, string> = {
  primary: "bg-[var(--accent-strong)] text-[#062824] hover:brightness-110 disabled:opacity-40",
  secondary: "bg-[var(--bg-panel-raised)] text-[var(--text-bright)] border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:opacity-40",
  danger: "bg-[var(--danger)] text-[#2a0a08] hover:brightness-110 disabled:opacity-40",
  ghost: "bg-transparent text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-40",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...props}
    />
  );
}

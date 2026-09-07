import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Status carries colour plus a second cue — the label itself — so it survives
 * colourblindness and greyscale printing.
 */
export function Badge({
  className,
  tone = "neutral",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "danger" | "warning" }) {
  const tones = {
    neutral: "border-edge text-content-secondary",
    success: "border-[var(--success)] text-[var(--success)]",
    danger: "border-[var(--danger)] text-[var(--danger)]",
    warning: "border-[var(--warning)] text-[var(--warning)]",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

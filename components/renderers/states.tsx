import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Every renderer handles four states explicitly. Loading is a skeleton at the
 * right dimensions rather than a spinner, so nothing jumps when data lands.
 */

export function SkeletonRows({ rows = 12, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex h-row items-center gap-4 border-b border-edge px-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <div
              key={columnIndex}
              className="skeleton h-3"
              style={{ width: columnIndex === 0 ? 180 : 110 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Empty states invite an action rather than describing absence. */
export function EmptyState({
  title,
  actions,
  className,
}: {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-6 py-6 text-center", className)}>
      <p className="text-sm text-content-secondary">{title}</p>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Errors say what happened and what to do. They don't apologise. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-6 py-6 text-center", className)}>
      <p className="flex items-center gap-2 text-sm text-[var(--danger)]">
        <AlertCircle size={14} aria-hidden />
        {message}
      </p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

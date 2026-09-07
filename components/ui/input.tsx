import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-control w-full rounded border border-edge bg-surface px-3 text-base text-content",
        "placeholder:text-content-muted disabled:opacity-50",
        "aria-[invalid=true]:border-[var(--danger)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded border border-edge bg-surface px-3 py-2.5 text-base text-content",
      "placeholder:text-content-muted disabled:opacity-50",
      "aria-[invalid=true]:border-[var(--danger)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-control w-full rounded border border-edge bg-surface px-3 text-base text-content",
      "aria-[invalid=true]:border-[var(--danger)]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

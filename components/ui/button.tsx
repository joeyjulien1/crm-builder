import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * One accent: the brand colour marks the primary action and nothing else.
 * Elevation is a border, not a shadow — see docs/DESIGN.md.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-[background-color,border-color,color,transform] duration-fast active:scale-[0.98] motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary: "border border-edge bg-surface text-content hover:bg-surface-hover",
        ghost: "text-content-secondary hover:bg-surface-hover hover:text-content",
        danger: "bg-[var(--danger)] text-white hover:opacity-90",
      },
      size: {
        default: "h-control px-4 text-base",
        sm: "h-[calc(var(--control-h)-4px)] px-3 text-sm",
        lg: "h-[calc(var(--control-h)+6px)] px-5 text-base",
        icon: "h-control w-control shrink-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };

"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

/**
 * shadcn popover, portalled into its density container rather than the body.
 *
 * Type and control sizes come from `--text-*` and `--control-h`, which are
 * defined on the `[data-density]` element so two route groups can differ — see
 * docs/DESIGN.md. Portalling to `document.body` escapes that element, and the
 * variables resolve to the :root floor instead of the density the component was
 * designed against. Portalling into the container keeps both: escape from
 * `overflow` clipping, and the right scale.
 */

interface DensityPortalContext {
  container: HTMLElement | null;
  register: (element: HTMLElement | null) => void;
}

const PortalContext = React.createContext<DensityPortalContext>({
  container: null,
  register: () => {},
});

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
}

function Popover({ children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  // Resolved from the trigger, since that is the part of the popover that lives
  // in the tree where the density is set.
  const register = React.useCallback((element: HTMLElement | null) => {
    setContainer(element?.closest<HTMLElement>("[data-density]") ?? null);
  }, []);

  const value = React.useMemo(() => ({ container, register }), [container, register]);

  return (
    <PortalContext.Provider value={value}>
      <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>
    </PortalContext.Provider>
  );
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, ref) => {
  const { register } = React.useContext(PortalContext);
  return (
    <PopoverPrimitive.Trigger
      ref={(element) => {
        assignRef(ref, element);
        register(element);
      }}
      {...props}
    />
  );
});
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => {
  const { container } = React.useContext(PortalContext);
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded border border-edge bg-surface-raised p-0 text-content shadow-[0_8px_24px_rgba(0,0,0,0.12)] outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };

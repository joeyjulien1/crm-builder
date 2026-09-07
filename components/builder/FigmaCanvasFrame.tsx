"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ViewportMode = "desktop" | "tablet" | "mobile";

interface FigmaCanvasFrameProps {
  viewport: ViewportMode;
  zoom: number;
  children: React.ReactNode;
}

const VIEWPORT_WIDTHS: Record<ViewportMode, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

const VIEWPORT_LABELS: Record<ViewportMode, string> = {
  desktop: "Desktop",
  tablet: "Tablet · 768 × 1024",
  mobile: "Phone · 390 × 844",
};

/**
 * The device frame around the CRM being built.
 *
 * It used to wrap every workspace in a black dot-grid surround with a heavy drop
 * shadow, which meant a light CRM was permanently displayed inside a dark studio
 * — the frame competing with the thing it framed. Two changes: it follows the
 * tenant's theme like everything else, and at desktop size it gets out of the
 * way entirely. A device frame earns its place when you are checking a phone
 * layout, not when you are using the product.
 */
export function FigmaCanvasFrame({ viewport, zoom, children }: FigmaCanvasFrameProps) {
  const isConstrained = viewport !== "desktop";

  if (!isConstrained && zoom === 1) {
    return <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-surface">{children}</div>;
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-start overflow-auto bg-surface-sunken p-4 md:p-6">
      <div className="mb-2.5 flex w-full max-w-full items-center justify-between px-2 text-xs text-content-muted">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="font-medium text-content-secondary">{VIEWPORT_LABELS[viewport]}</span>
        </span>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>

      <div
        className={cn(
          "flex origin-top flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-panel transition-all duration-300 ease-out",
          isConstrained ? "my-auto h-[860px]" : "h-full w-full",
        )}
        style={{ width: VIEWPORT_WIDTHS[viewport], transform: `scale(${zoom})` }}
      >
        {isConstrained && (
          <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken px-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-edge-strong" />
              <div className="h-2 w-2 rounded-full bg-edge-strong" />
              <div className="h-2 w-2 rounded-full bg-edge-strong" />
            </div>
            <span className="text-xs text-content-muted">{VIEWPORT_LABELS[viewport]}</span>
            <div className="w-8" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

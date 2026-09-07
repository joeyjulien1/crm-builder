"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Config } from "@/lib/config/types";
import { resolveTheme } from "@/lib/config/theme";
import { tabsSkin } from "@/components/screens/style";
import { Columns, Table as TableIcon, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectIdentity } from "./ProjectIdentity";

interface DynamicCrmCanvasProps {
  config: Config;
  onAskAgent?: (prompt: string) => void;
  children: React.ReactNode;
  /**
   * Inline preview mode (builder center canvas). When provided, the screen and
   * view tabs switch content in place instead of pushing a new route — the
   * generated CRM stays inside the page that built it.
   */
  activeScreenId?: string;
  activeViewId?: string;
  onSelectScreen?: (screenId: string) => void;
  onSelectView?: (viewId: string) => void;
}

/**
 * The CRM's own frame: its name, its navigation, and the body beneath.
 *
 * This is the most brand-defining surface in the product and it used to be the
 * least themeable — a second light/dark switch running off `brand.theme` on raw
 * slate and zinc, ignoring the tenant's palette, type and radius entirely. Every
 * colour here now comes from the same tokens the screens use, so the header
 * belongs to the CRM rather than to the builder that made it.
 */
export function DynamicCrmCanvas({
  config,
  children,
  activeScreenId,
  activeViewId,
  onSelectScreen,
  onSelectView,
}: DynamicCrmCanvasProps) {
  const router = useRouter();
  const pathname = usePathname();

  const brand = config.brand;
  const theme = React.useMemo(() => resolveTheme(config.theme), [config.theme]);
  const tabs = tabsSkin(theme);

  const navItem = (isActive: boolean) =>
    cn(
      "flex shrink-0 items-center gap-2 text-base font-medium px-3.5 py-1.5 transition",
      tabs.tab,
      isActive && tabs.active,
    );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface text-content transition-colors">
      <header className="shrink-0 border-b border-edge bg-surface-sunken px-6 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <ProjectIdentity brand={brand} theme={config.theme} />

          {/* Generated screens come first — they are the CRM the agent built;
              the older fixed-renderer views follow behind. */}
          <nav className={cn("overflow-x-auto", tabs.list)}>
            {[...(config.screens ?? [])]
              .sort((a, b) => a.position - b.position)
              .map((screen) => (
                <button
                  key={screen.id}
                  type="button"
                  onClick={() =>
                    onSelectScreen ? onSelectScreen(screen.id) : router.push(`/screens/${screen.id}`)
                  }
                  className={navItem(
                    onSelectScreen ? activeScreenId === screen.id : pathname === `/screens/${screen.id}`,
                  )}
                >
                  <LayoutDashboard size={15} />
                  <span>{screen.name}</span>
                </button>
              ))}

            {(config.views ?? []).map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => (onSelectView ? onSelectView(view.id) : router.push(`/views/${view.id}`))}
                className={navItem(
                  onSelectView ? activeViewId === view.id : pathname === `/views/${view.id}`,
                )}
              >
                {view.renderer === "kanban" ? <Columns size={15} /> : <TableIcon size={15} />}
                <span>{view.name}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-surface">
        {children}
      </div>
    </div>
  );
}

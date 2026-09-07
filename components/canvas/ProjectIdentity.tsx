import * as React from "react";
import type { BrandConfig, ThemeConfig } from "@/lib/config/types";
import { resolveTheme } from "@/lib/config/theme";
import { cn } from "@/lib/utils";

interface ProjectIdentityProps {
  brand?: BrandConfig;
  fallbackName?: string;
  subtitle?: string;
  theme?: ThemeConfig;
  size?: "default" | "compact";
  className?: string;
}

/** The project mark and title shared by the generated CRM and its Backend. */
export function ProjectIdentity({
  brand,
  fallbackName = "CRM Studio",
  subtitle,
  theme: themeConfig,
  size = "default",
  className,
}: ProjectIdentityProps) {
  const theme = React.useMemo(() => resolveTheme(themeConfig), [themeConfig]);
  const compact = size === "compact";
  const name = brand?.name ?? fallbackName;
  const detail = subtitle ?? brand?.tagline;

  return (
    <div className={cn("flex min-w-0 items-center", compact ? "gap-2.5" : "gap-3.5", className)}>
      {brand?.logoFileId ? (
        <img
          src={`/api/files/${brand.logoFileId}`}
          alt={`${name} logo`}
          className={cn(
            "shrink-0 object-cover",
            compact ? "h-9 w-9" : "h-11 w-11",
            theme.shape.radiusLg >= 9999 ? "rounded-full" : "rounded-lg",
          )}
        />
      ) : (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center bg-accent font-display font-bold text-accent-fg",
            compact ? "h-9 w-9 text-sm" : "h-11 w-11 text-base",
            theme.shape.radiusLg >= 9999 ? "rounded-full" : "rounded-lg",
          )}
          style={{ fontWeight: "var(--weight-display)" }}
          aria-hidden="true"
        >
          {brand?.logoText ?? name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <h1 className={cn("truncate font-display font-semibold tracking-tight text-content", compact ? "text-base" : "text-lg")}>
          {name}
        </h1>
        {detail && <p className={cn("truncate text-content-muted", compact ? "text-xs" : "text-sm")}>{detail}</p>}
      </div>
    </div>
  );
}

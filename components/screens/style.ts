import type { ThemeConfig, UiNode } from "@/lib/config/types";
import { cn } from "@/lib/utils";

/**
 * Resolves a node's style tokens and the theme's component variants into
 * classes.
 *
 * Two rules hold this together. Every class here resolves to a CSS variable the
 * theme sets — nothing reaches for a raw Tailwind colour or a fixed px value,
 * so a screen restyles with the theme rather than in spite of it. And the
 * variant tables below are where two CRMs stop looking related: a flush table on
 * tinted cards has no visual relationship to a bordered table on outlined ones,
 * without a single node in the tree changing.
 */

type Style = NonNullable<UiNode["style"]>;

/* -------------------------------------------------------------------------- */
/* Token maps                                                                  */
/* -------------------------------------------------------------------------- */

const PAD = { none: "p-0", xs: "p-1", sm: "p-2", md: "p-3", lg: "p-4", xl: "p-5" } as const;
const GAP = { none: "gap-0", xs: "gap-1", sm: "gap-2", md: "gap-3", lg: "gap-4", xl: "gap-5" } as const;

const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
} as const;

const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
} as const;

const TONE = {
  default: "text-content",
  muted: "text-content-muted",
  secondary: "text-content-secondary",
  accent: "text-content-accent",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
} as const;

const SIZE = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
} as const;

const WEIGHT = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
  display: "font-display",
} as const;

const FONT = { body: "font-sans", display: "font-display", mono: "font-mono" } as const;
const TEXT_ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
const RADIUS = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded",
  lg: "rounded-lg",
  full: "rounded-full",
} as const;
const SHADOW = {
  none: "shadow-none",
  card: "shadow-card",
  panel: "shadow-panel",
  overlay: "shadow-overlay",
} as const;
const FILL = {
  none: "",
  surface: "bg-surface",
  sunken: "bg-surface-sunken",
  raised: "bg-surface-raised",
  accent: "bg-accent text-accent-fg",
  accentSubtle: "bg-accent-subtle",
} as const;

/** Widths that used to be hardcoded at 256px and 288px. */
const WIDTH = {
  auto: "w-auto",
  full: "w-full",
  xs: "w-40",
  sm: "w-56",
  md: "w-72",
  lg: "w-96",
  xl: "w-[32rem]",
} as const;

const SPAN: Record<number, string> = {
  1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4",
  5: "col-span-5", 6: "col-span-6", 7: "col-span-7", 8: "col-span-8",
  9: "col-span-9", 10: "col-span-10", 11: "col-span-11", 12: "col-span-12",
};

export const COLS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4",
  5: "grid-cols-5", 6: "grid-cols-6", 7: "grid-cols-7", 8: "grid-cols-8",
  9: "grid-cols-9", 10: "grid-cols-10", 11: "grid-cols-11", 12: "grid-cols-12",
};

/**
 * Every style prop, resolved. Called by every node kind — a kind that skipped
 * this is a kind whose style props silently did nothing.
 */
export function styleClasses(node: UiNode): string {
  const style: Style = node.style ?? {};
  return cn(
    style.pad && PAD[style.pad],
    style.gap && GAP[style.gap],
    style.align && ALIGN[style.align],
    style.justify && JUSTIFY[style.justify],
    style.tone && TONE[style.tone],
    style.size && SIZE[style.size],
    style.weight && WEIGHT[style.weight],
    style.font && FONT[style.font],
    style.textAlign && TEXT_ALIGN[style.textAlign],
    style.uppercase && "uppercase tracking-theme",
    style.radius && RADIUS[style.radius],
    style.shadow && SHADOW[style.shadow],
    style.fill && FILL[style.fill],
    style.width && WIDTH[style.width],
    style.span && SPAN[style.span],
    style.border && "border border-edge",
    style.grow && "flex-1 min-w-0",
    style.scroll && "overflow-auto",
  );
}

/** True when the node set this prop itself, so a default should not apply. */
export function has(node: UiNode, prop: keyof Style): boolean {
  return node.style?.[prop] !== undefined;
}

/* -------------------------------------------------------------------------- */
/* Component variants                                                          */
/* -------------------------------------------------------------------------- */

export interface TableSkin {
  wrapper: string;
  head: string;
  headCell: string;
  row: string;
  cell: string;
  /** cards draws each record as its own block rather than a table row. */
  asCards: boolean;
}

const TABLE_SKINS: Record<string, TableSkin> = {
  bordered: {
    wrapper: "overflow-auto rounded border border-edge",
    head: "bg-surface-sunken",
    headCell: "border-b border-edge px-3 py-2 text-left font-medium text-content-secondary",
    row: "border-b border-edge last:border-0 hover:bg-surface-hover",
    cell: "px-3",
    asCards: false,
  },
  striped: {
    wrapper: "overflow-auto rounded border border-edge",
    head: "bg-surface-sunken",
    headCell: "border-b border-edge px-3 py-2 text-left font-medium text-content-secondary",
    row: "odd:bg-surface-sunken/60 hover:bg-surface-hover",
    cell: "px-3",
    asCards: false,
  },
  flush: {
    wrapper: "overflow-auto",
    head: "",
    headCell:
      "border-b border-edge-strong px-2 py-2 text-left font-medium uppercase tracking-theme text-content-muted",
    row: "border-b border-edge last:border-0 hover:bg-surface-hover",
    cell: "px-2",
    asCards: false,
  },
  cards: {
    wrapper: "flex flex-col gap-2",
    head: "",
    headCell: "",
    row: "rounded border border-edge bg-surface-raised p-3 shadow-card hover:border-edge-strong",
    cell: "",
    asCards: true,
  },
};

export function tableSkin(theme: ThemeConfig, override?: string): TableSkin {
  return TABLE_SKINS[override ?? theme.components.table] ?? TABLE_SKINS.bordered!;
}

const CARD_SKINS: Record<string, string> = {
  outlined: "rounded border border-edge bg-surface-raised",
  elevated: "rounded-lg bg-surface-raised shadow-card",
  flat: "rounded bg-surface-sunken",
  tinted: "rounded border border-edge bg-accent-subtle",
};

export function cardSkin(theme: ThemeConfig, override?: string): string {
  return CARD_SKINS[override ?? theme.components.card] ?? CARD_SKINS.outlined!;
}

const PANEL_SKINS: Record<string, string> = {
  outlined: "rounded border border-edge bg-surface-sunken",
  elevated: "rounded-lg bg-surface-raised shadow-panel",
  flat: "rounded bg-surface-sunken",
  tinted: "rounded border border-edge bg-accent-subtle",
};

export function panelSkin(theme: ThemeConfig, override?: string): string {
  return PANEL_SKINS[override ?? theme.components.card] ?? PANEL_SKINS.outlined!;
}

export interface TabsSkin {
  list: string;
  tab: string;
  active: string;
}

const TABS_SKINS: Record<string, TabsSkin> = {
  underline: {
    list: "flex items-center gap-1 border-b border-edge",
    tab: "px-3 py-1.5 transition text-content-muted hover:text-content",
    active: "border-b-2 border-accent font-medium text-content",
  },
  pill: {
    list: "flex items-center gap-1",
    tab: "rounded-full px-3 py-1 transition text-content-muted hover:text-content hover:bg-surface-hover",
    active: "bg-accent text-accent-fg font-medium",
  },
  segmented: {
    list: "inline-flex items-center gap-0.5 rounded border border-edge bg-surface-sunken p-0.5",
    tab: "rounded-sm px-3 py-1 transition text-content-muted hover:text-content",
    active: "bg-surface-raised text-content font-medium shadow-card",
  },
};

export function tabsSkin(theme: ThemeConfig, override?: string): TabsSkin {
  return TABS_SKINS[override ?? theme.components.tabs] ?? TABS_SKINS.underline!;
}

/** Maps the theme's button variant onto the Button component's own props. */
export function buttonSkin(
  theme: ThemeConfig,
  override?: string,
): { variant: "primary" | "secondary" | "ghost"; className: string } {
  switch (override ?? theme.components.button) {
    case "outline":
      return { variant: "secondary", className: "" };
    case "ghost":
      return { variant: "ghost", className: "" };
    case "pill":
      return { variant: "primary", className: "rounded-full px-4" };
    default:
      return { variant: "primary", className: "" };
  }
}

const BADGE_SKINS: Record<string, string> = {
  solid: "border-transparent bg-accent text-accent-fg",
  outline: "",
  dot: "border-transparent bg-transparent pl-0 before:mr-1.5 before:inline-block before:h-1.5 before:w-1.5 before:rounded-full before:bg-accent before:content-['']",
};

export function badgeSkin(theme: ThemeConfig, override?: string): string {
  return BADGE_SKINS[override ?? theme.components.badge] ?? BADGE_SKINS.outline!;
}

const INPUT_SKINS: Record<string, string> = {
  outlined: "",
  filled: "border-transparent bg-surface-sunken",
  underlined: "rounded-none border-x-0 border-t-0 border-b bg-transparent px-0",
};

export function inputSkin(theme: ThemeConfig, override?: string): string {
  return INPUT_SKINS[override ?? theme.components.input] ?? INPUT_SKINS.outlined!;
}

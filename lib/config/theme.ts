import type { ThemeConfig } from "./types";

/**
 * Turns theme configuration into the CSS custom properties the app reads.
 *
 * `app/globals.css` defines the semantic layer and `tailwind.config.ts` maps
 * every utility onto it, so overriding these variables on one container
 * restyles the whole CRM. They ride an inline style on the app shell — no CSS
 * is ever built by concatenating config into a string, so there is nothing to
 * escape.
 *
 * This used to offer four grey ramps and five radii. It now emits values the
 * agent generated. The readability guarantee moved from "you may only pick from
 * this list" to `assertReadable`, which is checked when a theme is staged.
 */

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Configs written before a key existed are read straight from JSONB without
 * being re-parsed, so every entry point fills its own defaults rather than
 * trusting the type. See lib/config/hydrate.ts.
 */
const DEFAULTS: ThemeConfig = {
  mode: "dark",
  colors: {
    surface: "#101013",
    sunken: "#0a0a0c",
    raised: "#17171b",
    hover: "#1f1f24",
    textPrimary: "#f4f4f5",
    textSecondary: "#a1a1a8",
    textMuted: "#6c6c75",
    borderSubtle: "#26262b",
    borderStrong: "#3d3d44",
    accent: "#4f63b5",
    danger: "#b4342f",
    success: "#1d7a52",
    warning: "#9a6510",
  },
  type: {
    fontBody: "system",
    baseSize: 15,
    scaleRatio: 1.2,
    lineHeight: 1.45,
    weightDisplay: 600,
    weightBody: 400,
    tracking: 0,
    uppercaseHeadings: false,
  },
  space: { unit: 3, ratio: 1.7, rowHeight: 40, controlHeight: 38 },
  shape: { radiusSm: 4, radiusMd: 6, radiusLg: 10, borderWidth: 1, focusWidth: 2, focusOffset: 2 },
  shadow: { style: "none", color: "#000000", opacity: 0.25 },
  motion: { easing: "standard", durationFast: 120, duration: 180 },
  components: {
    table: "bordered",
    card: "outlined",
    button: "solid",
    badge: "outline",
    tabs: "underline",
    input: "outlined",
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function resolveTheme(input?: DeepPartial<ThemeConfig>): ThemeConfig {
  const legacy = upgradeLegacyTheme(input);
  return {
    mode: legacy.mode ?? DEFAULTS.mode,
    colors: { ...DEFAULTS.colors, ...legacy.colors },
    type: { ...DEFAULTS.type, ...legacy.type },
    space: { ...DEFAULTS.space, ...legacy.space },
    shape: { ...DEFAULTS.shape, ...legacy.shape },
    shadow: { ...DEFAULTS.shadow, ...legacy.shadow },
    motion: { ...DEFAULTS.motion, ...legacy.motion },
    components: { ...DEFAULTS.components, ...legacy.components },
  };
}

/* -------------------------------------------------------------------------- */
/* Upgrading a theme written against the old closed sets                       */
/* -------------------------------------------------------------------------- */

/** The four ramps the theme used to choose between. Kept only to upgrade. */
const LEGACY_RAMPS: Record<string, Record<"light" | "dark", Partial<ThemeConfig["colors"]>>> = {
  zinc: {
    light: {
      surface: "#ffffff", sunken: "#fafafa", raised: "#ffffff", hover: "#f4f4f5",
      textPrimary: "#18181b", textSecondary: "#52525b", textMuted: "#a1a1aa",
      borderSubtle: "#e4e4e7", borderStrong: "#a1a1aa",
    },
    dark: {
      surface: "#101013", sunken: "#0a0a0c", raised: "#17171b", hover: "#1f1f24",
      textPrimary: "#f4f4f5", textSecondary: "#a1a1a8", textMuted: "#6c6c75",
      borderSubtle: "#26262b", borderStrong: "#3d3d44",
    },
  },
  slate: {
    light: {
      surface: "#ffffff", sunken: "#f8fafc", raised: "#ffffff", hover: "#f1f5f9",
      textPrimary: "#0f172a", textSecondary: "#475569", textMuted: "#94a3b8",
      borderSubtle: "#e2e8f0", borderStrong: "#94a3b8",
    },
    dark: {
      surface: "#0f1420", sunken: "#0a0e17", raised: "#161c2b", hover: "#1e2536",
      textPrimary: "#f1f5f9", textSecondary: "#a3b0c2", textMuted: "#6b7889",
      borderSubtle: "#232b3a", borderStrong: "#3a465a",
    },
  },
  stone: {
    light: {
      surface: "#ffffff", sunken: "#fafaf9", raised: "#ffffff", hover: "#f5f5f4",
      textPrimary: "#1c1917", textSecondary: "#57534e", textMuted: "#a8a29e",
      borderSubtle: "#e7e5e4", borderStrong: "#a8a29e",
    },
    dark: {
      surface: "#14110f", sunken: "#0d0b0a", raised: "#1c1917", hover: "#262220",
      textPrimary: "#f5f5f4", textSecondary: "#a8a29e", textMuted: "#78716c",
      borderSubtle: "#2b2624", borderStrong: "#453e3a",
    },
  },
  gray: {
    light: {
      surface: "#ffffff", sunken: "#f9fafb", raised: "#ffffff", hover: "#f3f4f6",
      textPrimary: "#111827", textSecondary: "#4b5563", textMuted: "#9ca3af",
      borderSubtle: "#e5e7eb", borderStrong: "#9ca3af",
    },
    dark: {
      surface: "#111318", sunken: "#0a0c10", raised: "#181b21", hover: "#20242c",
      textPrimary: "#f9fafb", textSecondary: "#a1a8b4", textMuted: "#6b7280",
      borderSubtle: "#252932", borderStrong: "#3a4048",
    },
  },
};

const LEGACY_RADII: Record<string, [number, number, number]> = {
  square: [0, 0, 0],
  small: [2, 3, 5],
  medium: [4, 6, 10],
  large: [6, 10, 16],
  pill: [9999, 9999, 9999],
};

/** The old font names, onto the faces that replaced them. */
const LEGACY_FONTS: Record<string, ThemeConfig["type"]["fontBody"]> = {
  system: "system",
  geometric: "sora",
  grotesk: "inter",
  humanist: "humanist",
  serif: "lora",
  slab: "slab",
  mono: "mono",
};

interface LegacyTheme {
  mode?: "light" | "dark";
  accent?: string;
  neutral?: string;
  radius?: string;
  density?: string;
  font?: string;
}

/**
 * A theme stored as the old six scalars becomes the equivalent token set, so an
 * existing workspace looks exactly as it did rather than being restyled out
 * from under whoever was using it.
 */
export function upgradeLegacyTheme(input?: DeepPartial<ThemeConfig>): DeepPartial<ThemeConfig> {
  if (!input || typeof input !== "object") return {};

  const legacy = input as LegacyTheme & DeepPartial<ThemeConfig>;
  const isLegacy = legacy.neutral !== undefined || legacy.radius !== undefined || legacy.density !== undefined;
  if (!isLegacy) return input;

  const mode = legacy.mode === "light" ? "light" : "dark";
  const ramp = LEGACY_RAMPS[legacy.neutral ?? "zinc"]?.[mode] ?? LEGACY_RAMPS.zinc![mode];
  const [radiusSm, radiusMd, radiusLg] = LEGACY_RADII[legacy.radius ?? "medium"] ?? LEGACY_RADII.medium!;
  const comfortable = legacy.density === "comfortable";

  return {
    ...input,
    mode,
    colors: { ...ramp, ...(legacy.accent ? { accent: legacy.accent } : {}), ...input.colors },
    type: {
      fontBody: LEGACY_FONTS[legacy.font ?? "system"] ?? "system",
      baseSize: comfortable ? 15 : 13,
      lineHeight: comfortable ? 1.55 : 1.45,
      ...input.type,
    },
    space: {
      unit: comfortable ? 4 : 2,
      rowHeight: comfortable ? 44 : 34,
      controlHeight: comfortable ? 36 : 30,
      ...input.space,
    },
    shape: { radiusSm, radiusMd, radiusLg, ...input.shape },
  };
}

/* -------------------------------------------------------------------------- */
/* Colour maths                                                               */
/* -------------------------------------------------------------------------- */

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance — sRGB linearised, not the Rec.709 approximation. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 1 (identical) to 21 (black on white). 4.5 is the body-text floor. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Moves a colour toward white or black. `amount` is 0 to 1. */
export function shift(hex: string, amount: number, toward: "white" | "black"): string {
  const target = toward === "white" ? 255 : 0;
  const parts = channels(hex).map((current) =>
    Math.round(current + (target - current) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * What a generated palette has to clear to be readable. This is the guarantee
 * that replaced the closed ramp list: the agent may choose any colours, and
 * these are the ones it may not.
 */
export function assertReadable(theme: ThemeConfig): string[] {
  const { colors } = theme;
  const problems: string[] = [];

  const check = (fg: string, bg: string, min: number, what: string) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) {
      problems.push(
        `${what} is ${ratio.toFixed(1)}:1 against its background and needs ${min}:1 — ${fg} on ${bg}`,
      );
    }
  };

  check(colors.textPrimary, colors.surface, 4.5, "Body text");
  check(colors.textSecondary, colors.surface, 3.5, "Secondary text");
  check(colors.textMuted, colors.surface, 2.5, "Muted text");
  check(colors.textPrimary, colors.raised, 4.5, "Body text on raised surfaces");
  check(accentForeground(theme), colors.accent, 4, "Text on the accent colour");

  if (contrastRatio(colors.borderSubtle, colors.surface) < 1.12) {
    problems.push(`Borders are invisible against the page — ${colors.borderSubtle} on ${colors.surface}`);
  }
  if (contrastRatio(colors.surface, colors.sunken) < 1.02 && contrastRatio(colors.surface, colors.raised) < 1.02) {
    problems.push("Surface, sunken and raised are the same colour, so nothing has depth");
  }

  return problems;
}

/** Black or white on the accent, whichever the eye can actually read. */
function accentForeground(theme: ThemeConfig): string {
  if (theme.colors.accentFg) return theme.colors.accentFg;
  return contrastRatio("#ffffff", theme.colors.accent) >= contrastRatio("#111111", theme.colors.accent)
    ? "#ffffff"
    : "#111111";
}

/* -------------------------------------------------------------------------- */
/* Scales                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The webfont entries point at variables next/font declares in app/layout.tsx,
 * each with a real fallback so a theme still reads if a face fails to load.
 */
const FONT_STACKS: Record<string, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
  humanist: "Optima, Gill Sans, Segoe UI, Candara, ui-sans-serif, sans-serif",
  slab: "Rockwell, Bookman, ui-serif, Georgia, serif",

  inter: "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif",
  sora: "var(--font-sora), Sora, ui-sans-serif, system-ui, sans-serif",
  spaceGrotesk: "var(--font-space-grotesk), Space Grotesk, ui-sans-serif, system-ui, sans-serif",
  fraunces: "var(--font-fraunces), Fraunces, ui-serif, Georgia, serif",
  lora: "var(--font-lora), Lora, ui-serif, Georgia, serif",
  mono: "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace",
};

const EASINGS: Record<string, string> = {
  linear: "linear",
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  decelerate: "cubic-bezier(0, 0, 0.2, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};

/** Layered box-shadows, so "elevated" reads as depth rather than a grey edge. */
function shadows(theme: ThemeConfig): { card: string; panel: string; overlay: string } {
  const { style, color, opacity } = theme.shadow;
  if (style === "none") return { card: "none", panel: "none", overlay: "none" };

  const tint = (alpha: number) => rgba(color, Math.min(1, opacity * alpha));
  const layers: Record<string, [string, string, string]> = {
    hairline: [
      `0 1px 0 ${tint(0.6)}`,
      `0 1px 0 ${tint(0.8)}`,
      `0 2px 6px ${tint(1)}`,
    ],
    soft: [
      `0 1px 2px ${tint(0.7)}, 0 2px 8px ${tint(0.5)}`,
      `0 2px 6px ${tint(0.8)}, 0 8px 24px ${tint(0.5)}`,
      `0 8px 24px ${tint(1)}`,
    ],
    medium: [
      `0 2px 4px ${tint(0.8)}, 0 6px 16px ${tint(0.6)}`,
      `0 4px 12px ${tint(0.9)}, 0 12px 32px ${tint(0.6)}`,
      `0 12px 40px ${tint(1)}`,
    ],
    strong: [
      `0 4px 8px ${tint(0.9)}, 0 12px 28px ${tint(0.8)}`,
      `0 8px 20px ${tint(1)}, 0 20px 48px ${tint(0.8)}`,
      `0 20px 60px ${tint(1)}`,
    ],
  };

  const [card, panel, overlay] = layers[style] ?? layers.soft!;
  return { card, panel, overlay };
}

/** A modular type scale: every size is the base stepped by the ratio. */
function typeScale(theme: ThemeConfig): Record<string, string> {
  const { baseSize, scaleRatio } = theme.type;
  const step = (exponent: number) => `${Math.round(baseSize * scaleRatio ** exponent * 10) / 10}px`;

  return {
    "--text-xs": step(-1),
    "--text-sm": step(-0.5),
    "--text-base": step(0),
    "--text-lg": step(1),
    "--text-xl": step(2),
    "--text-2xl": step(3),
  };
}

/** A geometric spacing scale from one unit and one ratio. */
function spaceScale(theme: ThemeConfig): Record<string, string> {
  const { unit, ratio } = theme.space;
  const out: Record<string, string> = {};
  for (let step = 1; step <= 6; step++) {
    out[`--space-${step}`] = `${Math.round(unit * ratio ** (step - 1))}px`;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The variables                                                               */
/* -------------------------------------------------------------------------- */

export function themeVars(input?: DeepPartial<ThemeConfig>): Record<string, string> {
  const theme = resolveTheme(input);
  const { colors, type, space, shape, motion } = theme;
  const shadow = shadows(theme);
  const accentFg = accentForeground(theme);
  const accentHover = shift(colors.accent, 0.18, theme.mode === "light" ? "black" : "white");
  const display = type.fontDisplay ?? type.fontBody;

  return {
    "--surface": colors.surface,
    "--surface-sunken": colors.sunken,
    "--surface-raised": colors.raised,
    "--surface-hover": colors.hover,

    "--text-primary": colors.textPrimary,
    "--text-secondary": colors.textSecondary,
    "--text-muted": colors.textMuted,
    "--text-accent": theme.mode === "light" ? shift(colors.accent, 0.2, "black") : accentHover,

    "--border-subtle": colors.borderSubtle,
    "--border-strong": colors.borderStrong,
    "--border": colors.borderSubtle,
    "--border-width": `${shape.borderWidth}px`,

    "--accent": colors.accent,
    "--accent-hover": accentHover,
    "--accent-fg": accentFg,
    "--accent-subtle": rgba(colors.accent, theme.mode === "light" ? 0.1 : 0.16),

    "--danger": colors.danger,
    "--success": colors.success,
    "--warning": colors.warning,

    "--focus-ring": colors.accent,
    "--focus-width": `${shape.focusWidth}px`,
    "--focus-offset": `${shape.focusOffset}px`,

    "--radius-sm": `${shape.radiusSm}px`,
    "--radius": `${shape.radiusMd}px`,
    "--radius-lg": `${shape.radiusLg}px`,

    "--shadow-card": shadow.card,
    "--shadow-panel": shadow.panel,
    "--shadow-overlay": shadow.overlay,

    "--font-sans": FONT_STACKS[type.fontBody] ?? FONT_STACKS.system!,
    "--font-display": FONT_STACKS[display] ?? FONT_STACKS.system!,
    "--weight-display": String(type.weightDisplay),
    "--weight-body": String(type.weightBody),
    "--tracking": `${type.tracking}em`,
    "--line-body": String(type.lineHeight),

    ...typeScale(theme),
    ...spaceScale(theme),

    "--control-h": `${space.controlHeight}px`,
    "--row-h": `${space.rowHeight}px`,

    "--ease": EASINGS[motion.easing] ?? EASINGS.standard!,
    "--dur-fast": `${motion.durationFast}ms`,
    "--dur": `${motion.duration}ms`,
  };
}

/**
 * `data-theme` drives Tailwind's dark: variant. Density no longer selects a
 * block in globals.css — the scale is emitted above — but the attribute stays
 * so anything still keyed to it keeps working.
 */
export function themeAttributes(input?: DeepPartial<ThemeConfig>): {
  "data-theme": string;
  "data-density": string;
} {
  const theme = resolveTheme(input);
  return {
    "data-theme": theme.mode,
    "data-density": theme.space.rowHeight >= 44 ? "comfortable" : "app",
  };
}

/** Row height in pixels, for the table virtualiser, which needs a number. */
export function rowHeightOf(input?: DeepPartial<ThemeConfig>): number {
  return resolveTheme(input).space.rowHeight;
}

/** One line, for the diff and for telling the user what changed. */
export function describeTheme(input?: DeepPartial<ThemeConfig>): string {
  const theme = resolveTheme(input);
  const { colors, type, components } = theme;
  return [
    theme.mode,
    `${colors.accent} accent on ${colors.surface}`,
    `${type.fontBody}${type.fontDisplay && type.fontDisplay !== type.fontBody ? `/${type.fontDisplay}` : ""} at ${type.baseSize}px`,
    `${components.table} tables`,
    `${components.card} cards`,
    `${components.button} buttons`,
    theme.shadow.style === "none" ? "flat" : `${theme.shadow.style} shadows`,
  ].join(", ");
}
